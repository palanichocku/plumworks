import { createHash } from "node:crypto";
import { centsToDecimal, parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";

export const LEGACY_PAYMENT_CONFIRMATION = "IMPORT_LEGACY_PAYMENTS";
// A fixed RFC 4122 namespace dedicated to Car Doc legacy AR tender identities.
export const LEGACY_PAYMENT_UUID_NAMESPACE = "4fd3a43c-e07d-4ac5-a931-89b860bcf857";

export const LEGACY_TENDER_BUCKETS = Object.freeze([
  { bucket: "CASH", method: "cash" },
  { bucket: "CHECK", method: "check" },
  { bucket: "AMEX", method: "card" },
  { bucket: "DISCOVER", method: "card" },
  { bucket: "MAST_VISA", method: "card" },
  { bucket: "ACCC", method: "internal" },
  { bucket: "ACCOUNT", method: "other" },
]);

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseLegacyPaymentImportArguments(argv = []) {
  const parsed = { shopId: undefined, explicitDryRun: false, confirmation: undefined };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--shop-id", "--dry-run", "--confirm"].includes(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`);
    seen.add(option);
    if (option === "--dry-run") parsed.explicitDryRun = true;
    else {
      const value = requireValue(argv, index, option);
      index += 1;
      if (option === "--shop-id") parsed.shopId = value;
      else parsed.confirmation = value;
    }
  }
  if (parsed.confirmation !== undefined && parsed.confirmation !== LEGACY_PAYMENT_CONFIRMATION) {
    throw new Error(`--confirm must equal ${LEGACY_PAYMENT_CONFIRMATION}.`);
  }
  if (parsed.explicitDryRun && parsed.confirmation === LEGACY_PAYMENT_CONFIRMATION) {
    throw new Error("--dry-run cannot be combined with confirmed write authorization.");
  }
  const confirmedWrite = parsed.confirmation === LEGACY_PAYMENT_CONFIRMATION;
  return {
    shopId: parsed.shopId,
    dryRun: !confirmedWrite,
    confirmedWrite,
    confirmationStatus: confirmedWrite ? "valid confirmation supplied" : "not supplied",
  };
}

function uuidBytes(value) {
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("Invalid deterministic UUID namespace.");
  return Buffer.from(hex, "hex");
}

export function deterministicLegacyPaymentId(shopId, legacyRoNo, bucket) {
  const identity = `${shopId}\n${String(legacyRoNo).trim()}\n${bucket}`;
  const bytes = createHash("sha1")
    .update(uuidBytes(LEGACY_PAYMENT_UUID_NAMESPACE))
    .update(identity, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function optionalLegacyCents(value) {
  if (value === null || value === undefined) return 0;
  return parseLegacyMoneyCents(value);
}

function requiredLegacyCents(rawData, field) {
  const cents = parseLegacyMoneyCents(rawData?.[field]);
  if (cents === null) throw new Error(`${field} is missing or malformed.`);
  return cents;
}

export function tenderReference(bucket) {
  return `Legacy tender bucket: ${bucket}`;
}

export function planLegacyPaymentOrder({ shopId, source, invoice }) {
  const legacyRoNo = source.legacyRoNo?.trim();
  if (!legacyRoNo) throw new Error("Raw AR row has no legacy RO number.");
  const bucketCents = new Map();
  for (const definition of LEGACY_TENDER_BUCKETS) {
    const cents = optionalLegacyCents(source.rawData?.[definition.bucket]);
    if (cents === null) throw new Error(`RO ${legacyRoNo} ${definition.bucket} is malformed.`);
    if (cents < 0) throw new Error(`RO ${legacyRoNo} ${definition.bucket} is negative.`);
    bucketCents.set(definition.bucket, cents);
  }
  const paymentCents = requiredLegacyCents(source.rawData, "PAYMENT");
  const totalCents = requiredLegacyCents(source.rawData, "TOTAL");
  const balanceCents = optionalLegacyCents(source.rawData?.BALANCE);
  if (balanceCents === null) throw new Error(`RO ${legacyRoNo} BALANCE is malformed.`);
  const tenderSumCents = [...bucketCents.values()].reduce((sum, cents) => sum + cents, 0);
  const tenderReconciles = tenderSumCents === paymentCents && paymentCents === totalCents - balanceCents;

  if (!invoice) {
    return { legacyRoNo, matched: false, tenderSumCents, paymentCents, totalCents, balanceCents, tenderReconciles, rows: [], invoiceReconciles: null };
  }
  if (!invoice.customerId) throw new Error(`RO ${legacyRoNo} operational invoice has no customer.`);
  if (!(invoice.invoiceDate instanceof Date) || Number.isNaN(invoice.invoiceDate.getTime())) {
    throw new Error(`RO ${legacyRoNo} operational invoice has no valid invoice date.`);
  }
  const rows = LEGACY_TENDER_BUCKETS.flatMap(({ bucket, method }) => {
    const cents = bucketCents.get(bucket);
    return cents === 0 ? [] : [{
      id: deterministicLegacyPaymentId(shopId, legacyRoNo, bucket),
      shopId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      amount: centsToDecimal(cents),
      method,
      // The exact receipt timestamp did not survive; invoiceDate is the historical proxy.
      paidAt: invoice.invoiceDate,
      reference: tenderReference(bucket),
      legacyRoNo,
      legacySourceTable: "ar.DBF",
      sourceBucket: bucket,
      amountCents: cents,
    }];
  });
  const proposedCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const invoicePaidCents = parseLegacyMoneyCents(String(invoice.paidTotal));
  const invoiceTotalCents = parseLegacyMoneyCents(String(invoice.total));
  const invoiceReconciles = proposedCents === invoicePaidCents && proposedCents === invoiceTotalCents;
  return { legacyRoNo, matched: true, tenderSumCents, paymentCents, totalCents, balanceCents, tenderReconciles, invoiceReconciles, rows };
}

function decimalCents(value) {
  return parseLegacyMoneyCents(String(value));
}

export const LEGACY_PAYMENT_PERSISTED_FIELDS = Object.freeze([
  "id", "shopId", "invoiceId", "customerId", "amount", "method", "paidAt",
  "reference", "legacyRoNo", "legacySourceTable",
]);

export function legacyPaymentRowsEqual(proposed, existing) {
  return proposed.id === existing.id &&
    proposed.shopId === existing.shopId &&
    proposed.invoiceId === existing.invoiceId &&
    proposed.customerId === existing.customerId &&
    decimalCents(proposed.amount) === decimalCents(existing.amount) &&
    proposed.method === existing.method &&
    new Date(proposed.paidAt).getTime() === new Date(existing.paidAt).getTime() &&
    proposed.reference === existing.reference &&
    proposed.legacyRoNo === existing.legacyRoNo &&
    proposed.legacySourceTable === existing.legacySourceTable;
}

export function classifyLegacyPaymentRows(proposedRows, existingRows) {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const inserts = [];
  const unchanged = [];
  const conflicts = [];
  for (const proposed of proposedRows) {
    const existing = existingById.get(proposed.id);
    if (!existing) inserts.push(proposed);
    else if (legacyPaymentRowsEqual(proposed, existing)) unchanged.push(proposed);
    else conflicts.push({ proposed, existing });
  }
  return { inserts, unchanged, conflicts };
}

export function paymentCreateData(row) {
  return Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, row[field]]));
}

export async function executeLegacyPaymentInsertTransaction({ confirmedWrite, prisma, proposedRows, chunkSize = 500 }) {
  if (!confirmedWrite) return { executed: false, databaseWrites: 0 };
  const databaseWrites = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.payment.findMany({
      where: { id: { in: proposedRows.map((row) => row.id) } },
      select: Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, true])),
    });
    const classification = classifyLegacyPaymentRows(proposedRows, existing);
    if (classification.conflicts.length > 0) {
      throw new Error(`${classification.conflicts.length} deterministic Payment ID collision(s) prevent import.`);
    }
    const inserts = classification.inserts;
    let count = 0;
    for (let index = 0; index < inserts.length; index += chunkSize) {
      const result = await transaction.payment.createMany({
        data: inserts.slice(index, index + chunkSize).map(paymentCreateData),
      });
      count += result.count;
    }
    return count;
  }, { timeout: 120_000 });
  return { executed: true, databaseWrites };
}
