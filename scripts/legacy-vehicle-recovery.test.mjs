import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectLegacyInvoicePaymentInputs } from "./lib/legacy-invoice-projection.mjs";
import { applyReviewedInvoiceVehicleLinks, deterministicRecoveredVehicleId, executeCutoverVehicleRecovery, planCutoverVehicleRecovery } from "./lib/legacy-vehicle-recovery.mjs";
import { VEHICLE_CREATE, VEHICLE_EVIDENCE_ONLY, VEHICLE_LINK } from "./lib/legacy-customer-recovery-proposal.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const source = (legacyCarno, key) => ({ stableRowKey: key, evidenceSha256: `${key}evidence`, deleted: false, rawData: { YEAR: "2012", MAKE: "Synthetic", MODEL: "Archive", VIN: `SYNTHETIC${legacyCarno}`, ODOMETER: "12345" } });
const candidate = (id, legacyVehicleId, orders, customerCandidateId = "customer:recovered") => ({
  candidateId: id, legacyVehicleId, recoveredCustomerCandidateId: customerCandidateId, recoveredCustomerLegacyId: "RECOVERED",
  affectedOrderNumbers: orders, sourceVehicle: { stableRowKey: `row:${legacyVehicleId}`, evidenceSha256: `row:${legacyVehicleId}evidence`, deleted: false },
});

function fixture() {
  const candidates = [candidate("vehicle:create", "V1", ["101"]), candidate("vehicle:link", "V2", ["102"]), candidate("vehicle:evidence", "V3", ["103"])];
  return {
    proposal: { vehicleCandidates: candidates },
    approval: { vehicleDecisions: [
      { candidateId: "vehicle:create", action: VEHICLE_CREATE, operationalState: "archived" },
      { candidateId: "vehicle:link", action: VEHICLE_LINK, targetLegacyVehicleId: "CANONICAL", targetEvidence: { legacyCustomerId: "CANONICAL-OWNER" } },
      { candidateId: "vehicle:evidence", action: VEHICLE_EVIDENCE_ONLY, reason: "Explicit synthetic review." },
    ] },
    sourceVehicleRows: [source("V1", "row:V1"), source("V2", "row:V2"), source("V3", "row:V3")],
    customers: [{ id: customerId, legacyCustno: "RECOVERED" }, { id: "44444444-4444-4444-8444-444444444444", legacyCustno: "CANONICAL-OWNER" }],
    vehicles: [{ id: "33333333-3333-4333-8333-333333333333", legacyCarno: "CANONICAL", customerId: "44444444-4444-4444-8444-444444444444" }],
  };
}

test("Vehicle recovery plans deterministic archived creation, exact canonical linking, and explicit evidence-only linkage", () => {
  const plan = planCutoverVehicleRecovery({ ...fixture(), shopId, snapshotDate: "2026-07-11" });
  assert.deepEqual(plan.fatalIssues, []);
  assert.deepEqual(plan.counts, { candidates: 3, creates: 1, canonicalLinks: 1, evidenceOnly: 1, affectedInvoices: 3, unresolved: 0 });
  assert.equal(plan.creates[0].id, deterministicRecoveredVehicleId(shopId, "V1"));
  assert.equal(plan.creates[0].archivedAt.toISOString(), "2026-07-11T00:00:00.000Z");
  assert.equal(plan.orderLinks.find((link) => link.legacyRoNo === "102").vehicleId, "33333333-3333-4333-8333-333333333333");
  assert.equal(plan.orderLinks.find((link) => link.legacyRoNo === "103").vehicleId, null);
});

test("Vehicle recovery fails closed for missing source, Customer, target, duplicate order, and missing decision", () => {
  const base = fixture();
  const missing = planCutoverVehicleRecovery({ ...base, sourceVehicleRows: [], customers: [], vehicles: [], shopId, snapshotDate: "2026-07-11" });
  assert.ok(missing.fatalIssues.some((issue) => issue.code === "stale-vehicle-source-evidence"));
  assert.ok(missing.fatalIssues.some((issue) => issue.code === "missing-recovered-vehicle-customer"));
  assert.ok(missing.fatalIssues.some((issue) => issue.code === "missing-canonical-vehicle-target"));
  const incomplete = planCutoverVehicleRecovery({ ...base, approval: { vehicleDecisions: base.approval.vehicleDecisions.slice(1) }, shopId, snapshotDate: "2026-07-11" });
  assert.ok(incomplete.fatalIssues.some((issue) => issue.code === "missing-vehicle-decisions"));
});

test("dry-run Vehicle execution performs zero writes and confirmed execution creates only reviewed Vehicles", async () => {
  const plan = planCutoverVehicleRecovery({ ...fixture(), shopId, snapshotDate: "2026-07-11" });
  let writes = 0;
  const prisma = { $transaction: async (callback) => callback({ vehicle: { create: async () => { writes += 1; } } }) };
  assert.deepEqual(await executeCutoverVehicleRecovery({ confirmedWrite: false, prisma, plan }), { databaseWrites: 0, createdVehicles: 0 });
  assert.equal(writes, 0);
  assert.deepEqual(await executeCutoverVehicleRecovery({ confirmedWrite: true, prisma, plan }), { databaseWrites: 1, createdVehicles: 1 });
});

test("historical Invoice linkage preserves Customer identity and applies exactly the reviewed Vehicle mapping", async () => {
  const plan = planCutoverVehicleRecovery({ ...fixture(), shopId, snapshotDate: "2026-07-11" });
  const updates = [];
  const invoices = new Map(plan.orderLinks.map((link, index) => [link.legacyRoNo, { id: `invoice-${index}`, customer: { legacyCustno: "RECOVERED" }, vehicleId: null }]));
  const prisma = { $transaction: async (callback) => callback({ invoice: {
    findFirst: async ({ where }) => invoices.get(where.legacyRoNo),
    update: async ({ where, data }) => { updates.push({ ...where, ...data }); },
  } }) };
  const result = await applyReviewedInvoiceVehicleLinks({ confirmedWrite: true, prisma, shopId, plan });
  assert.deepEqual(result, { databaseWrites: 2, linked: 2, evidenceOnly: 1 });
  assert.equal(updates.length, 2);
  assert.ok(updates.every((update) => !Object.hasOwn(update, "customerId")));
  invoices.get("101").customer.legacyCustno = "OTHER";
  await assert.rejects(applyReviewedInvoiceVehicleLinks({ confirmedWrite: true, prisma, shopId, plan }), /no longer matches/);
});

test("Invoice projection consumes every reviewed Vehicle link without changing financial or Customer identity", () => {
  const result = projectLegacyInvoicePaymentInputs({
    shopId, importRunId: "run", resolvedCustomers: [{ legacyCustno: "RECOVERED", customerId }],
    rawFinal: [], rawLabor: [],
    rawAr: [{ legacyRoNo: "101", legacyCustno: "RECOVERED", rawData: { RO_NO: "101", CUSTNO: "RECOVERED", PARTS: "10.00", LABOR: "0", TAX: "0", TAX2: "0", TAX3: "0", TAX4: "0", TAX5: "0", TAX6: "0", TOTAL: "10.00", PAYMENT: "10.00", BALANCE: "0.00", DATE_SOLD: "20260711" } }],
    reviewedVehicleLinks: [{ legacyRoNo: "101", vehicleId: "55555555-5555-4555-8555-555555555555", action: VEHICLE_CREATE }],
  });
  assert.deepEqual(result.fatalIssues, []);
  assert.equal(result.invoices[0].customerId, customerId);
  assert.equal(result.invoices[0].vehicleId, "55555555-5555-4555-8555-555555555555");
  assert.equal(result.invoices[0].total, "10.00");
});

test("existing lifecycle and history routes support archived recovered Vehicles and cross-owner historical Invoice scopes", async () => {
  const [actions, search, history] = await Promise.all([
    readFile("src/app/(app)/repair-orders/actions.ts", "utf8"),
    readFile("src/lib/data/search.ts", "utf8"),
    readFile("src/lib/data/repair-order-history.ts", "utf8"),
  ]);
  assert.match(actions, /archivedAt:\s*null/);
  assert.match(search, /vehicle[\s\S]*archivedAt:\s*null/i);
  assert.match(history, /customerId:\s*scope\.customerId,\s*vehicleId:\s*scope\.vehicleId/);
  assert.match(history, /customerId:\s*undefined/);
  assert.match(history, /vehicleId:\s*undefined/);
});
