import { createHash } from "node:crypto";
import { centsToDecimal, parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";

export const LEGACY_PAYMENT_CONFIRMATION = "IMPORT_LEGACY_PAYMENTS";
export const LEGACY_PAYMENT_DATE_POLICY = "invoice-date-proxy";
export const LEGACY_PAYMENT_DATE_LABEL = "Legacy payment tender allocation using Invoice date proxy";
export const APPROVED_RECOVERED_PAYMENT_AGGREGATE = Object.freeze({
  matchedInvoiceCount: 11_665,
  unmatchedInvoiceCount: 1,
  matchedCustomerCount: 11_665,
  unmatchedCustomerCount: 1,
  proposedPaymentRowCount: 11_825,
  proposedPaymentAmountCents: 421_796_410,
  zeroPaymentOrderCount: 39,
  splitTenderOrderCount: 189,
  tenderMismatchCount: 0,
  duplicateDeterministicKeyCount: 0,
});
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

export const LEGACY_PAYMENT_UNSUPPORTED_FIELDS = Object.freeze([
  { field: "DISCOUNT", classification: "already represented in Invoice totals", financial: true, fatalWhenNonzero: false },
  { field: "DEDUCT", classification: "already represented in Invoice totals", financial: true, fatalWhenNonzero: false },
  { field: "DEPOSIT", classification: "unsupported transaction detail", financial: true, fatalWhenNonzero: true },
  { field: "DIFF", classification: "fatal ambiguity", financial: true, fatalWhenNonzero: true },
  { field: "DIFF2", classification: "fatal ambiguity", financial: true, fatalWhenNonzero: true },
  { field: "DIFF3", classification: "fatal ambiguity", financial: true, fatalWhenNonzero: true },
  { field: "RECVD", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "PAID", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "CPAID", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "DELETE", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "COLLT", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "BADDEBT", classification: "unsupported transaction detail", financial: false, fatalWhenNonzero: true },
  { field: "COLDATE", classification: "informational", financial: false, fatalWhenNonzero: false },
  { field: "DEBTDATE", classification: "informational", financial: false, fatalWhenNonzero: false },
]);

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parsePaymentDatePolicyArgument(argv = []) {
  const positions = argv.flatMap((value, index) => value === "--payment-date-policy" ? [index] : []);
  if (positions.length !== 1) throw new Error("--payment-date-policy must be provided exactly once.");
  const value = argv[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error("--payment-date-policy requires a value.");
  if (value !== LEGACY_PAYMENT_DATE_POLICY) throw new Error(`--payment-date-policy must equal ${LEGACY_PAYMENT_DATE_POLICY}.`);
  return value;
}

export function parseLegacyPaymentImportArguments(argv = []) {
  const parsed = {
    shopId: undefined,
    importRunId: undefined,
    paymentDatePolicy: undefined,
    explicitDryRun: false,
    confirmation: undefined,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!["--shop-id", "--import-run-id", "--payment-date-policy", "--dry-run", "--confirm"].includes(option)) {
      throw new Error(`Unknown argument: ${option}`);
    }
    if (seen.has(option)) throw new Error(`Duplicate argument: ${option}`);
    seen.add(option);
    if (option === "--dry-run") parsed.explicitDryRun = true;
    else {
      const value = requireValue(argv, index, option);
      index += 1;
      if (option === "--shop-id") parsed.shopId = value;
      else if (option === "--import-run-id") parsed.importRunId = value;
      else if (option === "--payment-date-policy") parsed.paymentDatePolicy = value;
      else parsed.confirmation = value;
    }
  }
  if (!parsed.importRunId) throw new Error("--import-run-id is required.");
  if (!validUuid(parsed.importRunId)) throw new Error("--import-run-id must be a valid UUID.");
  parsed.paymentDatePolicy = parsePaymentDatePolicyArgument(argv);
  if (parsed.confirmation !== undefined && parsed.confirmation !== LEGACY_PAYMENT_CONFIRMATION) {
    throw new Error(`--confirm must equal ${LEGACY_PAYMENT_CONFIRMATION}.`);
  }
  if (parsed.explicitDryRun && parsed.confirmation === LEGACY_PAYMENT_CONFIRMATION) {
    throw new Error("--dry-run cannot be combined with confirmed write authorization.");
  }
  const confirmedWrite = parsed.confirmation === LEGACY_PAYMENT_CONFIRMATION;
  return {
    shopId: parsed.shopId,
    importRunId: parsed.importRunId,
    paymentDatePolicy: parsed.paymentDatePolicy,
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

function moneyCents(rawData, field, { optional = false } = {}) {
  const value = rawData?.[field];
  if (optional && (value === null || value === undefined)) return 0;
  return parseLegacyMoneyCents(value);
}

function decimalCents(value) {
  return parseLegacyMoneyCents(String(value));
}

function meaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  const text = String(value).trim();
  if (!text) return false;
  const cents = parseLegacyMoneyCents(text);
  return cents === null ? !["F", "FALSE", "N", "NO"].includes(text.toUpperCase()) : cents !== 0;
}

function add(map, key, cents) {
  const current = map.get(key) ?? { count: 0, amountCents: 0 };
  map.set(key, { count: current.count + 1, amountCents: current.amountCents + cents });
}

function periodKey(date) {
  return date.toISOString().slice(0, 7);
}

function sourceSignature(row) {
  const keys = new Set([
    ...LEGACY_TENDER_BUCKETS.map(({ bucket }) => bucket),
    ...LEGACY_PAYMENT_UNSUPPORTED_FIELDS.map(({ field }) => field),
    "PAYMENT", "TOTAL", "BALANCE",
    ...Object.keys(row.rawData ?? {}).filter((key) => key.toUpperCase().includes("CREDIT")),
  ]);
  return JSON.stringify({
    legacyCustno: row.legacyCustno?.trim() ?? "",
    values: [...keys].sort().map((key) => [key, row.rawData?.[key] ?? null]),
  });
}

export function tenderReference(bucket) {
  return `Legacy tender bucket: ${bucket}`;
}

export const LEGACY_PAYMENT_PERSISTED_FIELDS = Object.freeze([
  "id", "shopId", "invoiceId", "customerId", "amount", "method", "paidAt",
  "payerType", "reference", "note", "legacyRoNo", "legacySourceTable",
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

export function classifyLegacyPaymentRows(proposedRows, existingRows = []) {
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

export function projectLegacyPayments({
  shopId,
  importRunId,
  stagedArRows,
  invoices,
  resolvedCustomers,
  paymentDatePolicy,
  existingRows = [],
}) {
  if (!shopId || !importRunId) throw new Error("shopId and importRunId are required projection inputs.");
  if (paymentDatePolicy !== LEGACY_PAYMENT_DATE_POLICY) throw new Error(`Unsupported payment-date policy: ${paymentDatePolicy ?? "missing"}.`);
  if (!Array.isArray(stagedArRows) || !Array.isArray(invoices) || !Array.isArray(resolvedCustomers)) {
    throw new Error("stagedArRows, invoices, and resolvedCustomers must be explicit arrays.");
  }

  const warnings = [];
  const fatalIssues = [];
  const unmatchedRecords = [];
  const perInvoiceReconciliation = [];
  const unsupportedFieldClassifications = new Map();
  const sourceBucketTotals = new Map(LEGACY_TENDER_BUCKETS.map(({ bucket }) => [bucket, { count: 0, amountCents: 0 }]));
  const normalizedMethodTotals = new Map(["cash", "check", "card", "internal", "other"].map((method) => [method, { count: 0, amountCents: 0 }]));
  const periodTotals = new Map();
  const dailyPeriodTotals = new Map();
  const invoicesByRo = new Map();
  const duplicateInvoiceRos = new Set();
  for (const invoice of invoices) {
    const ro = invoice.legacyRoNo?.trim();
    if (!ro) continue;
    if (invoicesByRo.has(ro)) duplicateInvoiceRos.add(ro);
    else invoicesByRo.set(ro, invoice);
  }
  if (duplicateInvoiceRos.size) fatalIssues.push({ code: "duplicate-invoice-key", count: duplicateInvoiceRos.size });
  const customerByLegacy = new Map();
  for (const resolution of resolvedCustomers) {
    const key = resolution.legacyCustno?.trim();
    if (!key) continue;
    const current = customerByLegacy.get(key);
    if (current && current.customerId !== resolution.customerId) fatalIssues.push({ code: "conflicting-customer-resolution", count: 1 });
    else customerByLegacy.set(key, { customerId: resolution.customerId, resolutionType: resolution.resolutionType ?? "normal" });
  }

  const groups = new Map();
  let blankSourceKeyCount = 0;
  for (const source of stagedArRows) {
    if (source.legacyImportRunId && source.legacyImportRunId !== importRunId) {
      fatalIssues.push({ code: "wrong-import-run-row", count: 1 });
      continue;
    }
    if (source.shopId && source.shopId !== shopId) {
      fatalIssues.push({ code: "cross-shop-source-row", count: 1 });
      continue;
    }
    const ro = source.legacyRoNo?.trim();
    if (!ro) { blankSourceKeyCount += 1; continue; }
    const rows = groups.get(ro) ?? [];
    rows.push({ ...source, legacyRoNo: ro });
    groups.set(ro, rows);
  }
  if (blankSourceKeyCount) fatalIssues.push({ code: "missing-source-key", count: blankSourceKeyCount });

  let identicalDuplicateSourceKeyCount = 0;
  let conflictingSourceKeyCount = 0;
  let invalidProxyDateCount = 0;
  let tenderMismatchCount = 0;
  let invoiceMismatchCount = 0;
  let matchedInvoiceCount = 0;
  let unmatchedInvoiceCount = 0;
  let matchedCustomerCount = 0;
  let unmatchedCustomerCount = 0;
  let zeroPaymentOrderCount = 0;
  let partialPaymentOrderCount = 0;
  let fullyPaidOrderCount = 0;
  let splitTenderOrderCount = 0;
  const customerResolutionCounts = { normal: 0, recovered: 0, alias: 0 };
  const proposedRows = [];

  for (const [legacyRoNo, duplicates] of groups) {
    const signatures = new Set(duplicates.map(sourceSignature));
    if (duplicates.length > 1) {
      if (signatures.size === 1) {
        identicalDuplicateSourceKeyCount += 1;
        warnings.push({ code: "identical-source-duplicate", legacyRoNo, duplicateCount: duplicates.length });
      } else {
        conflictingSourceKeyCount += 1;
        fatalIssues.push({ code: "conflicting-source-duplicate", legacyRoNo, duplicateCount: duplicates.length });
        continue;
      }
    }
    // Identical duplicates represent one source order; use the first staged row deterministically.
    const source = duplicates[0];
    const rawData = source.rawData ?? {};
    const paymentCents = moneyCents(rawData, "PAYMENT");
    const totalCents = moneyCents(rawData, "TOTAL");
    // Staging preserves a blank fixed-width BALANCE as null; in DBF numeric semantics that is zero.
    const balanceCents = Object.hasOwn(rawData, "BALANCE")
      ? moneyCents(rawData, "BALANCE", { optional: true })
      : null;
    if ([paymentCents, totalCents, balanceCents].includes(null)) {
      fatalIssues.push({ code: "malformed-authoritative-amount", legacyRoNo });
      continue;
    }

    const buckets = [];
    let malformedBucket = false;
    for (const definition of LEGACY_TENDER_BUCKETS) {
      const cents = moneyCents(rawData, definition.bucket, { optional: true });
      if (cents === null) {
        fatalIssues.push({ code: "malformed-tender-bucket", legacyRoNo, field: definition.bucket });
        malformedBucket = true;
      } else if (cents < 0) {
        fatalIssues.push({ code: "negative-tender-bucket", legacyRoNo, field: definition.bucket });
        malformedBucket = true;
      } else buckets.push({ ...definition, cents });
    }
    if (malformedBucket) continue;

    const dynamicCreditFields = Object.keys(rawData)
      .filter((field) => field.toUpperCase().includes("CREDIT"))
      .filter((field) => !LEGACY_PAYMENT_UNSUPPORTED_FIELDS.some((definition) => definition.field === field));
    const definitions = [
      ...LEGACY_PAYMENT_UNSUPPORTED_FIELDS,
      ...dynamicCreditFields.map((field) => ({ field, classification: "unsupported transaction detail", financial: true, fatalWhenNonzero: true })),
    ];
    for (const definition of definitions) {
      const value = rawData[definition.field];
      if (!meaningful(value)) continue;
      let cents = 0;
      if (definition.financial) {
        const parsed = parseLegacyMoneyCents(value);
        if (parsed === null) {
          fatalIssues.push({ code: "malformed-unsupported-financial-field", legacyRoNo, field: definition.field });
          continue;
        }
        cents = parsed;
      }
      const key = `${definition.field}:${definition.classification}`;
      const aggregate = unsupportedFieldClassifications.get(key) ?? { ...definition, count: 0, amountCents: 0 };
      aggregate.count += 1;
      aggregate.amountCents += cents;
      unsupportedFieldClassifications.set(key, aggregate);
      if (definition.fatalWhenNonzero) fatalIssues.push({ code: "unsupported-financial-ambiguity", legacyRoNo, field: definition.field });
    }

    const tenderSumCents = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);
    const tenderReconciles = tenderSumCents === paymentCents;
    const sourceBalanceReconciles = totalCents - paymentCents === balanceCents;
    if (!tenderReconciles || !sourceBalanceReconciles) {
      tenderMismatchCount += Number(!tenderReconciles);
      fatalIssues.push({ code: "source-financial-mismatch", legacyRoNo });
    }

    const invoice = invoicesByRo.get(legacyRoNo) ?? null;
    const customerResolution = customerByLegacy.get(source.legacyCustno?.trim() ?? "") ?? null;
    const customerId = customerResolution?.customerId ?? null;
    if (invoice) matchedInvoiceCount += 1;
    else unmatchedInvoiceCount += 1;
    if (customerId) {
      matchedCustomerCount += 1;
      customerResolutionCounts[customerResolution.resolutionType] = (customerResolutionCounts[customerResolution.resolutionType] ?? 0) + 1;
    }
    else unmatchedCustomerCount += 1;
    if (!invoice || !customerId) {
      unmatchedRecords.push({ legacyRoNo, legacyCustno: source.legacyCustno?.trim() ?? "", paymentCents, invoiceMatched: Boolean(invoice), customerMatched: Boolean(customerId) });
      if (paymentCents > 0) fatalIssues.push({ code: !invoice ? "unmatched-paid-invoice" : "unmatched-paid-customer", legacyRoNo });
    }
    if (invoice && customerId && invoice.customerId !== customerId) fatalIssues.push({ code: "customer-mismatch", legacyRoNo });

    const invoiceTotalCents = invoice ? decimalCents(invoice.total) : null;
    const invoicePaidCents = invoice ? decimalCents(invoice.paidTotal) : null;
    const invoiceReconciles = Boolean(invoice) && invoiceTotalCents === totalCents && invoicePaidCents === paymentCents && invoiceTotalCents - invoicePaidCents === balanceCents;
    if (invoice && !invoiceReconciles) {
      invoiceMismatchCount += 1;
      fatalIssues.push({ code: "invoice-financial-mismatch", legacyRoNo });
    }

    if (paymentCents === 0) zeroPaymentOrderCount += 1;
    else if (balanceCents === 0) fullyPaidOrderCount += 1;
    else partialPaymentOrderCount += 1;
    const nonzeroBuckets = buckets.filter((bucket) => bucket.cents > 0);
    if (nonzeroBuckets.length > 1) splitTenderOrderCount += 1;

    let paidAt = null;
    if (invoice && invoice.invoiceDate instanceof Date && !Number.isNaN(invoice.invoiceDate.getTime())) paidAt = invoice.invoiceDate;
    else if (invoice) {
      invalidProxyDateCount += 1;
      fatalIssues.push({ code: "invalid-invoice-date-proxy", legacyRoNo });
    }

    const rows = invoice && customerId && invoice.customerId === customerId && paidAt
      ? nonzeroBuckets.map(({ bucket, method, cents }) => ({
          id: deterministicLegacyPaymentId(shopId, legacyRoNo, bucket),
          shopId,
          invoiceId: invoice.id,
          customerId,
          amount: centsToDecimal(cents),
          method,
          payerType: "OTHER",
          paidAt,
          reference: tenderReference(bucket),
          note: null,
          legacyRoNo,
          legacySourceTable: "ar.DBF",
          sourceBucket: bucket,
          amountCents: cents,
        }))
      : [];
    const proposedPaymentCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    const proposedRowsReconcile = !invoice || !customerId || invoice.customerId !== customerId || !paidAt
      ? paymentCents === 0
      : proposedPaymentCents === invoicePaidCents;
    if (!proposedRowsReconcile) fatalIssues.push({ code: "proposed-payment-mismatch", legacyRoNo });
    proposedRows.push(...rows);
    for (const row of rows) {
      add(sourceBucketTotals, row.sourceBucket, row.amountCents);
      add(normalizedMethodTotals, row.method, row.amountCents);
      add(periodTotals, periodKey(row.paidAt), row.amountCents);
      add(dailyPeriodTotals, row.paidAt.toISOString().slice(0, 10), row.amountCents);
    }
    perInvoiceReconciliation.push({
      legacyRoNo,
      invoiceId: invoice?.id ?? null,
      paymentCents,
      totalCents,
      balanceCents,
      tenderSumCents,
      proposedPaymentCents,
      tenderReconciles,
      sourceBalanceReconciles,
      invoiceReconciles,
      proposedRowsReconcile,
    });
  }

  const deterministicIds = new Set();
  let duplicateDeterministicKeyCount = 0;
  for (const row of proposedRows) {
    if (deterministicIds.has(row.id)) duplicateDeterministicKeyCount += 1;
    deterministicIds.add(row.id);
  }
  if (duplicateDeterministicKeyCount) fatalIssues.push({ code: "duplicate-deterministic-id", count: duplicateDeterministicKeyCount });
  const existingClassification = classifyLegacyPaymentRows(proposedRows, existingRows);
  if (existingClassification.conflicts.length) fatalIssues.push({ code: "deterministic-id-conflict", count: existingClassification.conflicts.length });

  return {
    label: LEGACY_PAYMENT_DATE_LABEL,
    importRunId,
    stagedArRowCount: stagedArRows.length,
    eligibleInvoiceCount: matchedInvoiceCount,
    matchedInvoiceCount,
    unmatchedInvoiceCount,
    matchedCustomerCount,
    unmatchedCustomerCount,
    proposedRows,
    proposedPaymentAmountCents: proposedRows.reduce((sum, row) => sum + row.amountCents, 0),
    existing: existingClassification,
    unmatchedRecords,
    conflicts: existingClassification.conflicts,
    sourceBucketTotals: Object.fromEntries(sourceBucketTotals),
    normalizedMethodTotals: Object.fromEntries(normalizedMethodTotals),
    perInvoiceReconciliation,
    periodTotals: Object.fromEntries(periodTotals),
    dailyPeriodTotals: Object.fromEntries(dailyPeriodTotals),
    unsupportedFieldClassifications: [...unsupportedFieldClassifications.values()],
    warnings,
    fatalIssues,
    counts: {
      zeroPaymentOrderCount,
      partialPaymentOrderCount,
      fullyPaidOrderCount,
      splitTenderOrderCount,
      identicalDuplicateSourceKeyCount,
      conflictingSourceKeyCount,
      duplicateDeterministicKeyCount,
      invalidProxyDateCount,
      tenderMismatchCount,
      invoiceMismatchCount,
      unmatchedZeroPaymentCount: unmatchedRecords.filter((record) => record.paymentCents === 0).length,
      unmatchedNonzeroPaymentCount: unmatchedRecords.filter((record) => record.paymentCents > 0).length,
      customerResolutionCounts,
    },
  };
}

export function paymentCreateData(row) {
  return Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, row[field]]));
}

export function legacyPaymentAggregateSummary(projection) {
  return {
    matchedInvoiceCount: projection.matchedInvoiceCount,
    unmatchedInvoiceCount: projection.unmatchedInvoiceCount,
    matchedCustomerCount: projection.matchedCustomerCount,
    unmatchedCustomerCount: projection.unmatchedCustomerCount,
    proposedPaymentRowCount: projection.proposedRows.length,
    proposedPaymentAmountCents: projection.proposedPaymentAmountCents,
    zeroPaymentOrderCount: projection.counts.zeroPaymentOrderCount,
    splitTenderOrderCount: projection.counts.splitTenderOrderCount,
    tenderMismatchCount: projection.counts.tenderMismatchCount,
    duplicateDeterministicKeyCount: projection.counts.duplicateDeterministicKeyCount,
  };
}

export async function executeLegacyPaymentInsertTransaction({ confirmedWrite, prisma, projection, chunkSize = 500 }) {
  if (!confirmedWrite) return { executed: false, databaseWrites: 0 };
  if (!projection || projection.fatalIssues.length > 0) throw new Error("Validated payment projection is required before writing.");
  const proposedRows = projection.proposedRows;
  const databaseWrites = await prisma.$transaction(async (transaction) => {
    const existing = proposedRows.length === 0 ? [] : await transaction.payment.findMany({
      where: { id: { in: proposedRows.map((row) => row.id) } },
      select: Object.fromEntries(LEGACY_PAYMENT_PERSISTED_FIELDS.map((field) => [field, true])),
    });
    const classification = classifyLegacyPaymentRows(proposedRows, existing);
    if (classification.conflicts.length > 0) throw new Error(`${classification.conflicts.length} deterministic Payment ID collision(s) prevent import.`);
    let count = 0;
    for (let index = 0; index < classification.inserts.length; index += chunkSize) {
      const result = await transaction.payment.createMany({ data: classification.inserts.slice(index, index + chunkSize).map(paymentCreateData) });
      count += result.count;
    }
    return count;
  }, { timeout: 120_000 });
  return { executed: true, databaseWrites };
}
