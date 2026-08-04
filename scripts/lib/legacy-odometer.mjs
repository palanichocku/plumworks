export const INVOICE_ODOMETER_BACKFILL_CONFIRMATION = "BACKFILL_INVOICE_ODOMETER";

export function normalizeLegacyOdometer(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  const compact = text.replaceAll(",", "").replaceAll(" ", "");
  const match = compact.match(/^(\d+(?:\.\d+)?)(K)?$/);
  if (!match) return null;
  const numeric = Number(match[1]) * (match[2] ? 1_000 : 1);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 10_000_000) return null;
  return numeric;
}

export function parseInvoiceOdometerBackfillArguments(argv = []) {
  const parsed = { shopId: null, importRunId: null, confirmed: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--shop-id", "--import-run-id", "--dry-run", "--confirm"].includes(option)) throw new Error(`Unknown argument: ${option}`);
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`);
    seen.add(option);
    if (option === "--dry-run") continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
    index += 1;
    if (option === "--shop-id") parsed.shopId = value;
    else if (option === "--import-run-id") parsed.importRunId = value;
    else {
      if (value !== INVOICE_ODOMETER_BACKFILL_CONFIRMATION) throw new Error(`--confirm must equal ${INVOICE_ODOMETER_BACKFILL_CONFIRMATION}.`);
      parsed.confirmed = true;
    }
  }
  if (!parsed.shopId || !parsed.importRunId) throw new Error("--shop-id and --import-run-id are required.");
  if (seen.has("--dry-run") && parsed.confirmed) throw new Error("--dry-run cannot be combined with confirmed write authorization.");
  return { ...parsed, dryRun: !parsed.confirmed };
}

export function projectInvoiceOdometerBackfill({ shopId, rawRows, invoices }) {
  const valuesByRo = new Map();
  let sourceValuesFound = 0;
  for (const row of rawRows) {
    if (row.shopId !== shopId) continue;
    const legacyRoNo = row.legacyRoNo?.trim();
    const odometer = normalizeLegacyOdometer(row.rawData?.ODOMETER);
    if (!legacyRoNo || odometer === null) continue;
    sourceValuesFound += 1;
    const values = valuesByRo.get(legacyRoNo) ?? new Set();
    values.add(odometer);
    valuesByRo.set(legacyRoNo, values);
  }
  const invoiceByRo = new Map(invoices.filter((invoice) => invoice.shopId === shopId && invoice.legacyRoNo).map((invoice) => [invoice.legacyRoNo, invoice]));
  const updates = [];
  let matchedRecords = 0;
  let alreadyCorrect = 0;
  let unresolved = 0;
  let ambiguous = 0;
  for (const [legacyRoNo, values] of valuesByRo) {
    if (values.size !== 1) {
      ambiguous += 1;
      continue;
    }
    const invoice = invoiceByRo.get(legacyRoNo);
    if (!invoice) {
      unresolved += 1;
      continue;
    }
    matchedRecords += 1;
    const odometer = [...values][0];
    if (invoice.odometer === odometer) alreadyCorrect += 1;
    else updates.push({ id: invoice.id, shopId, legacyRoNo, odometer });
  }
  return { sourceValuesFound, destinationRecordsMatched: matchedRecords, alreadyCorrect, proposedUpdates: updates.length, unresolved, ambiguous, updates };
}

export async function executeInvoiceOdometerBackfill({ confirmed, plan, update }) {
  if (!confirmed) return { databaseWrites: 0 };
  if (plan.ambiguous > 0) throw new Error("Ambiguous legacy odometer matches prevent backfill.");
  let databaseWrites = 0;
  for (const row of plan.updates) databaseWrites += await update(row);
  return { databaseWrites };
}
