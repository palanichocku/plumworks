import { createHash } from "node:crypto";
import { vehicleData } from "./customer-vehicle-transform.mjs";
import { VEHICLE_CREATE, VEHICLE_EVIDENCE_ONLY, VEHICLE_LINK } from "./legacy-customer-recovery-proposal.mjs";

export const RECOVERED_VEHICLE_UUID_NAMESPACE = "ed75b133-97c0-48f8-a7d2-56e985096ff0";

function uuidBytes(value) { return Buffer.from(value.replaceAll("-", ""), "hex"); }
export function deterministicRecoveredVehicleId(shopId, legacyCarno) {
  const bytes = createHash("sha1").update(uuidBytes(RECOVERED_VEHICLE_UUID_NAMESPACE)).update(`${shopId}\n${legacyCarno.trim()}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalized(value) { return value == null ? "" : String(value).trim().toUpperCase(); }

export function planCutoverVehicleRecovery({ approval, proposal, sourceVehicleRows, customers, vehicles, shopId, snapshotDate }) {
  const candidates = new Map((proposal.vehicleCandidates ?? []).map((candidate) => [candidate.candidateId, candidate]));
  const sourceByKey = new Map(sourceVehicleRows.map((row) => [row.stableRowKey, row]));
  const customerByLegacy = new Map(customers.filter((row) => row.legacyCustno).map((row) => [normalized(row.legacyCustno), row]));
  const vehicleByLegacy = new Map(vehicles.filter((row) => row.legacyCarno).map((row) => [normalized(row.legacyCarno), row]));
  const creates = [];
  const canonicalLinks = [];
  const evidenceOnly = [];
  const orderLinks = [];
  const fatalIssues = [];
  const seenVehicles = new Set();
  const seenOrders = new Set();
  for (const decision of approval.vehicleDecisions ?? []) {
    const candidate = candidates.get(decision.candidateId);
    if (!candidate) { fatalIssues.push({ code: "unknown-vehicle-decision", candidateId: decision.candidateId }); continue; }
    if (seenVehicles.has(candidate.legacyVehicleId)) { fatalIssues.push({ code: "duplicate-vehicle-decision", legacyVehicleId: candidate.legacyVehicleId }); continue; }
    seenVehicles.add(candidate.legacyVehicleId);
    const source = sourceByKey.get(candidate.sourceVehicle.stableRowKey);
    const customer = customerByLegacy.get(candidate.recoveredCustomerLegacyId);
    if (!source || source.evidenceSha256 !== candidate.sourceVehicle.evidenceSha256 || source.deleted !== candidate.sourceVehicle.deleted) fatalIssues.push({ code: "stale-vehicle-source-evidence", legacyVehicleId: candidate.legacyVehicleId });
    if (!customer) fatalIssues.push({ code: "missing-recovered-vehicle-customer", legacyVehicleId: candidate.legacyVehicleId });
    let vehicleId = null;
    if (decision.action === VEHICLE_CREATE && source && customer) {
      const existing = vehicleByLegacy.get(candidate.legacyVehicleId);
      if (existing) fatalIssues.push({ code: "recovered-vehicle-legacy-id-collision", legacyVehicleId: candidate.legacyVehicleId });
      const transformed = vehicleData({ legacyCustno: candidate.recoveredCustomerLegacyId, legacyCarno: candidate.legacyVehicleId, rawData: source.rawData });
      if (!transformed) fatalIssues.push({ code: "invalid-recovered-vehicle-source", legacyVehicleId: candidate.legacyVehicleId });
      else {
        vehicleId = deterministicRecoveredVehicleId(shopId, candidate.legacyVehicleId);
        const data = { ...transformed };
        delete data.legacyCustno;
        creates.push({ id: vehicleId, shopId, customerId: customer.id, ...data, archivedAt: decision.operationalState === "active" ? null : new Date(`${snapshotDate}T00:00:00.000Z`) });
      }
    } else if (decision.action === VEHICLE_LINK) {
      const target = vehicleByLegacy.get(decision.targetLegacyVehicleId);
      if (!target) fatalIssues.push({ code: "missing-canonical-vehicle-target", legacyVehicleId: candidate.legacyVehicleId });
      else {
        const reviewedOwner = customerByLegacy.get(decision.targetEvidence?.legacyCustomerId);
        if (!reviewedOwner || reviewedOwner.id !== target.customerId) fatalIssues.push({ code: "canonical-vehicle-ownership-changed", legacyVehicleId: candidate.legacyVehicleId });
        else { vehicleId = target.id; canonicalLinks.push({ legacyVehicleId: candidate.legacyVehicleId, targetVehicleId: target.id, targetLegacyVehicleId: target.legacyCarno }); }
      }
    } else if (decision.action === VEHICLE_EVIDENCE_ONLY) evidenceOnly.push({ legacyVehicleId: candidate.legacyVehicleId, reason: decision.reason });
    else fatalIssues.push({ code: "unknown-vehicle-recovery-action", legacyVehicleId: candidate.legacyVehicleId });
    for (const legacyRoNo of candidate.affectedOrderNumbers) {
      if (seenOrders.has(legacyRoNo)) fatalIssues.push({ code: "duplicate-vehicle-order-link", legacyRoNo });
      seenOrders.add(legacyRoNo);
      orderLinks.push({ legacyRoNo, legacyVehicleId: candidate.legacyVehicleId, customerLegacyId: candidate.recoveredCustomerLegacyId, vehicleId, action: decision.action });
    }
  }
  if (seenVehicles.size !== candidates.size) fatalIssues.push({ code: "missing-vehicle-decisions", expected: candidates.size, actual: seenVehicles.size });
  const counts = { candidates: candidates.size, creates: creates.length, canonicalLinks: canonicalLinks.length, evidenceOnly: evidenceOnly.length, affectedInvoices: orderLinks.length, unresolved: fatalIssues.length };
  return { creates, canonicalLinks, evidenceOnly, orderLinks, fatalIssues, counts };
}

export async function executeCutoverVehicleRecovery({ confirmedWrite, prisma, plan }) {
  if (!confirmedWrite) return { databaseWrites: 0, createdVehicles: 0 };
  if (plan.fatalIssues.length) throw new Error("Vehicle recovery plan contains fatal issues.");
  let writes = 0;
  await prisma.$transaction(async (transaction) => {
    for (const data of plan.creates) { await transaction.vehicle.create({ data }); writes += 1; }
  });
  return { databaseWrites: writes, createdVehicles: plan.creates.length };
}

export async function applyReviewedInvoiceVehicleLinks({ confirmedWrite, prisma, shopId, plan }) {
  if (!confirmedWrite) return { databaseWrites: 0, linked: 0, evidenceOnly: plan.evidenceOnly.length };
  if (plan.fatalIssues.length) throw new Error("Vehicle recovery plan contains fatal issues.");
  let writes = 0;
  await prisma.$transaction(async (transaction) => {
    for (const link of plan.orderLinks) {
      const invoice = await transaction.invoice.findFirst({ where: { shopId, legacyRoNo: link.legacyRoNo, legacySourceTable: { not: null } }, select: { id: true, customer: { select: { legacyCustno: true } }, vehicleId: true } });
      if (!invoice || invoice.customer.legacyCustno !== link.customerLegacyId) throw new Error(`Historical Invoice ${link.legacyRoNo} no longer matches its reviewed Vehicle recovery Customer.`);
      if (invoice.vehicleId !== link.vehicleId) { await transaction.invoice.update({ where: { id: invoice.id }, data: { vehicleId: link.vehicleId } }); writes += 1; }
    }
  });
  return { databaseWrites: writes, linked: plan.orderLinks.filter((link) => link.vehicleId).length, evidenceOnly: plan.orderLinks.filter((link) => !link.vehicleId).length };
}
