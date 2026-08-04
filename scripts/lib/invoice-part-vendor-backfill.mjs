import { createHash } from "node:crypto";

export const INVOICE_PART_VENDOR_CONFIRMATION = "BACKFILL_INVOICE_PART_VENDOR";
export const INVOICE_PART_VENDOR_BATCH_SIZE = 750;

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseInvoicePartVendorBackfillArguments(argv = []) {
  const parsed = { shopId: null, importRunId: null, dryRun: false, confirmation: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--shop-id", "--import-run-id", "--dry-run", "--confirm"].includes(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`);
    seen.add(option);
    if (option === "--dry-run") parsed.dryRun = true;
    else {
      const value = requiredValue(argv, index, option);
      index += 1;
      if (option === "--shop-id") parsed.shopId = value;
      else if (option === "--import-run-id") parsed.importRunId = value;
      else parsed.confirmation = value;
    }
  }
  if (!parsed.shopId) throw new Error("--shop-id is required.");
  if (!parsed.importRunId) throw new Error("--import-run-id is required.");
  if (parsed.confirmation && parsed.confirmation !== INVOICE_PART_VENDOR_CONFIRMATION) {
    throw new Error(`--confirm must equal ${INVOICE_PART_VENDOR_CONFIRMATION}.`);
  }
  if (parsed.dryRun && parsed.confirmation) {
    throw new Error("--dry-run cannot be combined with confirmed write authorization.");
  }
  return {
    shopId: parsed.shopId,
    importRunId: parsed.importRunId,
    confirmedWrite: parsed.confirmation === INVOICE_PART_VENDOR_CONFIRMATION,
  };
}

function textValue(rawData, field) {
  const value = rawData && typeof rawData === "object" ? rawData[field] : null;
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  return normalized || null;
}

function stableHash(rawData) {
  return createHash("sha256").update(JSON.stringify(rawData)).digest("hex").slice(0, 24);
}

export function projectLegacyFinalPartLines(rows) {
  const occurrences = new Map();
  const projected = [];
  for (const row of rows) {
    const legacyRoNo = row.legacyRoNo?.trim();
    if (!legacyRoNo) continue;
    const description = textValue(row.rawData, "DESC");
    const partNumber = textValue(row.rawData, "PARTNO");
    if (!description && !partNumber) continue;
    const hash = stableHash(row.rawData);
    const occurrenceKey = `${legacyRoNo}:${hash}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    projected.push({
      legacyRoNo,
      legacyLineKey: `FINAL:${legacyRoNo}:${hash}:${occurrence}`,
      vendorNameSnapshot: textValue(row.rawData, "SOURCE"),
    });
  }
  return projected;
}

export function buildInvoicePartVendorBackfillPlan(sourceLines, destinationLines) {
  const sourceByKey = new Map();
  const ambiguousKeys = new Set();
  for (const source of sourceLines) {
    const existing = sourceByKey.get(source.legacyLineKey);
    if (existing) ambiguousKeys.add(source.legacyLineKey);
    else sourceByKey.set(source.legacyLineKey, source);
  }
  const destinationByKey = new Map();
  for (const destination of destinationLines) {
    if (destinationByKey.has(destination.legacyLineKey)) ambiguousKeys.add(destination.legacyLineKey);
    else destinationByKey.set(destination.legacyLineKey, destination);
  }

  const updates = [];
  let sourceVendorValues = 0;
  let matchedDestinationLines = 0;
  let alreadyCorrect = 0;
  let missingSourceVendor = 0;
  let conflicts = 0;
  let unresolved = 0;
  for (const source of sourceLines) {
    if (ambiguousKeys.has(source.legacyLineKey)) continue;
    const destination = destinationByKey.get(source.legacyLineKey);
    if (destination) matchedDestinationLines += 1;
    const vendor = source.vendorNameSnapshot?.trim() || null;
    if (!vendor) {
      missingSourceVendor += 1;
      continue;
    }
    sourceVendorValues += 1;
    if (!destination) {
      unresolved += 1;
      continue;
    }
    const current = destination.vendorNameSnapshot?.trim() || null;
    if (current === vendor) alreadyCorrect += 1;
    else if (current) conflicts += 1;
    else updates.push({ id: destination.id, vendorNameSnapshot: vendor });
  }
  return {
    sourceLinesEvaluated: sourceLines.length,
    sourceVendorValues,
    matchedDestinationLines,
    alreadyCorrect,
    proposedUpdates: updates.length,
    missingSourceVendor,
    conflicts,
    unresolved,
    ambiguous: ambiguousKeys.size,
    updates,
  };
}

export function assertVendorBackfillWritable(plan) {
  if (plan.conflicts || plan.unresolved || plan.ambiguous) {
    throw new Error("Vendor backfill refused: conflicts, unresolved matches, or ambiguous matches exist.");
  }
}

export function chunkVendorUpdates(updates, batchSize = INVOICE_PART_VENDOR_BATCH_SIZE) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("Vendor batch size must be a positive integer.");
  const batches = [];
  for (let index = 0; index < updates.length; index += batchSize) {
    batches.push(updates.slice(index, index + batchSize));
  }
  return batches;
}

export async function executeVendorUpdateTransaction({
  prisma,
  shopId,
  updates,
  updateBatch,
  batchSize = INVOICE_PART_VENDOR_BATCH_SIZE,
}) {
  const batches = chunkVendorUpdates(updates, batchSize);
  try {
    return await prisma.$transaction(async (transaction) => {
      let affectedRows = 0;
      for (const batch of batches) {
        const affected = await updateBatch(transaction, shopId, batch);
        if (affected !== batch.length) {
          throw new Error("guarded-count-mismatch");
        }
        affectedRows += affected;
      }
      if (affectedRows !== updates.length) throw new Error("guarded-count-mismatch");
      return affectedRows;
    }, { timeout: 300_000 });
  } catch {
    throw new Error("Vendor backfill failed; the transaction was rolled back.");
  }
}
