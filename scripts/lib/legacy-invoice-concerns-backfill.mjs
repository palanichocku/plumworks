import { createHash } from "node:crypto";

export const LEGACY_INVOICE_CONCERNS_CONFIRMATION = "BACKFILL_LEGACY_INVOICE_CONCERNS";

function normalized(value) {
  return typeof value === "string" ? value.trim() || null : null;
}

function utcDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function sourceValue(row, field) {
  return normalized(row?.rawData?.[field]);
}

function oneResolvedId(values) {
  const resolved = new Set(values.filter(Boolean));
  return resolved.size === 1 ? [...resolved][0] : null;
}

export function parseLegacyInvoiceConcernsBackfillArguments(args) {
  const valueOptions = new Set(["--shop-id", "--source-root", "--snapshot-manifest", "--database-fingerprint", "--evidence-output", "--confirm"]);
  const allowed = new Set([...valueOptions, "--dry-run"]);
  for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);
  const value = (name) => {
    const positions = args.flatMap((item, index) => item === name ? [index] : []);
    if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
    const result = args[positions[0] + 1];
    if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
    return result;
  };
  const shopId = value("--shop-id");
  const sourceRoot = value("--source-root");
  const snapshotManifest = value("--snapshot-manifest");
  const databaseFingerprint = value("--database-fingerprint");
  const evidencePositions = args.flatMap((item, index) => item === "--evidence-output" ? [index] : []);
  if (evidencePositions.length > 1) throw new Error("--evidence-output may be supplied only once.");
  const evidenceOutput = evidencePositions.length ? value("--evidence-output") : null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shopId)) throw new Error("--shop-id must be a valid UUID.");
  if (!/^[0-9a-f]{64}$/.test(databaseFingerprint)) throw new Error("--database-fingerprint must be a SHA-256 value.");
  if (args.filter((item) => item === "--dry-run").length > 1) throw new Error("--dry-run may be supplied only once.");
  const confirmationPositions = args.flatMap((item, index) => item === "--confirm" ? [index] : []);
  if (confirmationPositions.length > 1) throw new Error("--confirm may be supplied only once.");
  const confirmation = confirmationPositions.length ? value("--confirm") : null;
  if (confirmation && confirmation !== LEGACY_INVOICE_CONCERNS_CONFIRMATION) throw new Error(`--confirm must equal ${LEGACY_INVOICE_CONCERNS_CONFIRMATION}.`);
  if (confirmation && args.includes("--dry-run")) throw new Error("--dry-run cannot be combined with confirmed writes.");
  return { shopId, sourceRoot, snapshotManifest, databaseFingerprint, evidenceOutput, confirmedWrite: confirmation === LEGACY_INVOICE_CONCERNS_CONFIRMATION, dryRun: !confirmation };
}

export function planLegacyInvoiceConcernsBackfill({ invoices, headers, aliases = [] }) {
  const issues = [];
  const headerGroups = new Map();
  for (const header of headers) {
    const legacyRoNo = normalized(header.legacyRoNo);
    if (!legacyRoNo) continue;
    const group = headerGroups.get(legacyRoNo) ?? [];
    group.push(header);
    headerGroups.set(legacyRoNo, group);
  }
  const headerByRo = new Map();
  for (const [legacyRoNo, rows] of headerGroups) {
    const signatures = new Set(rows.map((row) => JSON.stringify([
      normalized(row.legacyCustno), normalized(row.legacyCarno), sourceValue(row, "DATE_SOLD"),
      sourceValue(row, "VNOTES"), sourceValue(row, "RECOMEND"),
    ])));
    if (signatures.size !== 1) {
      issues.push({ code: "source-conflict", legacyRoNo });
      continue;
    }
    headerByRo.set(legacyRoNo, rows[0]);
  }
  const aliasCustomerByLegacy = new Map();
  for (const alias of aliases) {
    const key = normalized(alias.aliasLegacyCustno);
    if (!key) continue;
    const values = aliasCustomerByLegacy.get(key) ?? [];
    values.push(alias.customerId);
    aliasCustomerByLegacy.set(key, values);
  }
  const proposals = [];
  const classifications = [];
  for (const invoice of invoices) {
    const legacyRoNo = normalized(invoice.legacyRoNo);
    const header = legacyRoNo ? headerByRo.get(legacyRoNo) : null;
    if (!header) {
      classifications.push({ code: "header-absent", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    const sourceCustomer = normalized(header.legacyCustno);
    const exactCustomer = sourceCustomer === normalized(invoice.customer?.legacyCustno) ? invoice.customerId : null;
    const resolvedCustomer = oneResolvedId([exactCustomer, ...(aliasCustomerByLegacy.get(sourceCustomer) ?? [])]);
    if (!resolvedCustomer || resolvedCustomer !== invoice.customerId) {
      classifications.push({ code: "customer-mismatch", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    const sourceVehicle = normalized(header.legacyCarno);
    if (sourceVehicle && invoice.vehicleId && sourceVehicle !== normalized(invoice.vehicle?.legacyCarno)) {
      classifications.push({ code: "vehicle-mismatch", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    if (sourceVehicle && !invoice.vehicleId) {
      classifications.push({ code: "vehicle-mismatch", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    if (sourceValue(header, "DATE_SOLD") !== utcDateKey(invoice.invoiceDate)) {
      classifications.push({ code: "sold-date-mismatch", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    const desiredComplaint = sourceValue(header, "VNOTES");
    const desiredRecommendation = sourceValue(header, "RECOMEND");
    const currentComplaint = normalized(invoice.customerComplaint);
    const currentRecommendation = normalized(invoice.recommendation);
    const conflict = (currentComplaint && currentComplaint !== desiredComplaint) ||
      (currentRecommendation && currentRecommendation !== desiredRecommendation);
    if (conflict) {
      classifications.push({ code: "existing-target-conflict", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    const complaintChanges = currentComplaint !== desiredComplaint;
    const recommendationChanges = currentRecommendation !== desiredRecommendation;
    if (!complaintChanges && !recommendationChanges) {
      classifications.push({ code: "already-current", legacyRoNo, invoiceId: invoice.id });
      continue;
    }
    proposals.push({
      id: invoice.id, legacyRoNo,
      beforeCustomerComplaint: invoice.customerComplaint ?? null,
      beforeRecommendation: invoice.recommendation ?? null,
      customerComplaint: desiredComplaint,
      recommendation: desiredRecommendation,
      complaintChanges,
      recommendationChanges,
    });
    classifications.push({ code: "proposed-update", legacyRoNo, invoiceId: invoice.id });
  }
  const count = (code) => classifications.filter((item) => item.code === code).length;
  return {
    proposals,
    issues,
    classifications,
    counts: {
      inspected: invoices.length,
      exactMatches: invoices.length - count("header-absent"),
      headersAbsent: count("header-absent"),
      complaintUpdates: proposals.filter((proposal) => proposal.complaintChanges).length,
      recommendationUpdates: proposals.filter((proposal) => proposal.recommendationChanges).length,
      bothFieldUpdates: proposals.filter((proposal) => proposal.complaintChanges && proposal.recommendationChanges).length,
      alreadyCurrent: count("already-current"),
      targetConflicts: count("existing-target-conflict"),
      sourceConflicts: issues.filter((issue) => issue.code === "source-conflict").length,
      customerMismatches: count("customer-mismatch"),
      vehicleMismatches: count("vehicle-mismatch"),
      soldDateMismatches: count("sold-date-mismatch"),
      unmatched: classifications.filter((item) => !["proposed-update", "already-current"].includes(item.code)).length,
    },
  };
}

export function canonicalInvoiceControlHash(invoices) {
  const fields = ["id", "total", "paidTotal", "partsTotal", "laborTotal", "shopSuppliesAmount", "taxTotal", "invoiceDate", "closedAt", "status", "odometer", "customerId", "vehicleId", "repairOrderId"];
  const canonical = invoices.map((invoice) => Object.fromEntries(fields.map((field) => {
    const value = invoice[field];
    return [field, value instanceof Date ? value.toISOString() : value === null || value === undefined ? null : String(value)];
  }))).sort((left, right) => left.id.localeCompare(right.id));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function executeLegacyInvoiceConcernsBackfill({ transaction, shopId, proposals, batchSize = 500 }) {
  let updated = 0;
  for (let offset = 0; offset < proposals.length; offset += batchSize) {
    const batch = proposals.slice(offset, offset + batchSize);
    const columns = 5;
    const values = batch.map((_, row) => `($${row * columns + 1}::uuid, $${row * columns + 2}::text, $${row * columns + 3}::text, $${row * columns + 4}::text, $${row * columns + 5}::text)`).join(", ");
    const parameters = batch.flatMap((proposal) => [
      proposal.id, proposal.customerComplaint, proposal.recommendation,
      proposal.beforeCustomerComplaint, proposal.beforeRecommendation,
    ]);
    const rows = await transaction.$queryRawUnsafe(
      `WITH proposed(id, new_complaint, new_recommendation, old_complaint, old_recommendation) AS (VALUES ${values})
       UPDATE invoices AS invoice
       SET customer_complaint = proposed.new_complaint,
           recommendation = proposed.new_recommendation
       FROM proposed
       WHERE invoice.id = proposed.id
         AND invoice.shop_id = $${parameters.length + 1}::uuid
         AND invoice.legacy_source_table IS NOT NULL
         AND invoice.customer_complaint IS NOT DISTINCT FROM proposed.old_complaint
         AND invoice.recommendation IS NOT DISTINCT FROM proposed.old_recommendation
       RETURNING invoice.id`,
      ...parameters,
      shopId,
    );
    if (rows.length !== batch.length) throw new Error("Concurrent Invoice text change detected; the entire backfill transaction was rolled back.");
    updated += rows.length;
  }
  return { updated };
}
