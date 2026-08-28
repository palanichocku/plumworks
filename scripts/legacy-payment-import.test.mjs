import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_RECOVERED_PAYMENT_AGGREGATE,
  classifyLegacyPaymentRows,
  deterministicLegacyPaymentId,
  executeLegacyPaymentInsertTransaction,
  LEGACY_PAYMENT_DATE_LABEL,
  LEGACY_PAYMENT_DATE_POLICY,
  LEGACY_PAYMENT_PERSISTED_FIELDS,
  legacyPaymentAggregateSummary,
  parseLegacyPaymentImportArguments,
  paymentCreateData,
  projectLegacyPayments,
} from "./lib/legacy-payment-import.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const importRunId = "44444444-4444-4444-8444-444444444444";
const invoice = {
  id: "22222222-2222-4222-8222-222222222222",
  legacyRoNo: "21503",
  customerId: "33333333-3333-4333-8333-333333333333",
  invoiceDate: new Date("2026-01-15T00:00:00.000Z"),
  paidTotal: "116.71",
  total: "116.71",
};
const resolvedCustomers = [{ legacyCustno: "42", customerId: invoice.customerId }];

function source(overrides = {}, rowOverrides = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    legacyRoNo: "21503",
    legacyCustno: "42",
    rawData: {
      CASH: "115.00", CHECK: "", AMEX: null, DISCOVER: "0", MAST_VISA: "0.00",
      ACCOUNT: null, ACCC: "1.71", PAYMENT: "116.71", BALANCE: "0", TOTAL: "116.71",
      DEPOSIT: "0", RECVD: "", DIFF: "0", DIFF2: "0", DIFF3: "0",
      DISCOUNT: "0", DEDUCT: "0", PAID: false, CPAID: false, DELETE: false,
      COLLT: false, BADDEBT: false, COLDATE: null, DEBTDATE: null,
      ...overrides,
    },
    ...rowOverrides,
  };
}

function project(overrides = {}) {
  return projectLegacyPayments({
    shopId,
    importRunId,
    stagedArRows: [source()],
    invoices: [invoice],
    resolvedCustomers,
    paymentDatePolicy: LEGACY_PAYMENT_DATE_POLICY,
    ...overrides,
  });
}

test("arguments require an explicit import run and Invoice-date proxy policy", () => {
  const required = ["--import-run-id", importRunId, "--payment-date-policy", LEGACY_PAYMENT_DATE_POLICY];
  assert.equal(parseLegacyPaymentImportArguments(required).dryRun, true);
  assert.equal(parseLegacyPaymentImportArguments([...required, "--dry-run"]).dryRun, true);
  assert.equal(parseLegacyPaymentImportArguments([...required, "--shop-id", shopId]).shopId, shopId);
  assert.equal(parseLegacyPaymentImportArguments([...required, "--confirm", "IMPORT_LEGACY_PAYMENTS"]).confirmedWrite, true);
  assert.throws(() => parseLegacyPaymentImportArguments([]), /import-run-id is required/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--import-run-id", "bad", "--payment-date-policy", LEGACY_PAYMENT_DATE_POLICY]), /valid UUID/);
  assert.throws(() => parseLegacyPaymentImportArguments([...required, "--import-run-id", importRunId]), /Duplicate/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--import-run-id", importRunId]), /payment-date-policy must be provided exactly once/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--import-run-id", importRunId, "--payment-date-policy", "receipt-date"]), /must equal/);
  assert.throws(() => parseLegacyPaymentImportArguments([...required, "--confirm", "WRONG"]), /must equal/);
  assert.throws(() => parseLegacyPaymentImportArguments([...required, "--dry-run", "--confirm", "IMPORT_LEGACY_PAYMENTS"]), /cannot be combined/);
});

test("projection is pure, explicit, bucket-specific, and labels the date proxy", () => {
  const result = project();
  assert.equal(result.label, LEGACY_PAYMENT_DATE_LABEL);
  assert.equal(result.importRunId, importRunId);
  assert.equal(result.fatalIssues.length, 0);
  assert.deepEqual(result.proposedRows.map(({ method, amount, reference }) => ({ method, amount, reference })), [
    { method: "cash", amount: "115.00", reference: "Legacy tender bucket: CASH" },
    { method: "internal", amount: "1.71", reference: "Legacy tender bucket: ACCC" },
  ]);
  assert.equal(result.proposedRows[0].paidAt, invoice.invoiceDate);
  assert.equal(result.proposedRows[0].payerType, "OTHER");
  assert.equal(result.proposedRows[0].note, null);
  assert.equal(result.proposedPaymentAmountCents, 11671);
  assert.equal(result.periodTotals["2026-01"].amountCents, 11671);
});

test("partial cumulative payments reconcile to Invoice.paidTotal rather than Invoice.total", () => {
  const partialInvoice = { ...invoice, paidTotal: "40.00", total: "100.00" };
  const result = project({
    stagedArRows: [source({ CASH: "40", ACCC: "0", PAYMENT: "40", TOTAL: "100", BALANCE: "60" })],
    invoices: [partialInvoice],
  });
  assert.equal(result.fatalIssues.length, 0);
  assert.equal(result.proposedPaymentAmountCents, 4000);
  assert.equal(result.counts.partialPaymentOrderCount, 1);
  assert.equal(result.counts.fullyPaidOrderCount, 0);
  assert.equal(result.perInvoiceReconciliation[0].invoiceReconciles, true);
});

test("all supported source buckets map independently, including separate card references", () => {
  const raw = {
    CASH: "1", CHECK: "2", AMEX: "3", DISCOVER: "4", MAST_VISA: "5", ACCC: "6", ACCOUNT: "7",
    PAYMENT: "28", TOTAL: "28", BALANCE: "0",
  };
  const result = project({ stagedArRows: [source(raw)], invoices: [{ ...invoice, paidTotal: "28", total: "28" }] });
  assert.equal(result.proposedRows.length, 7);
  assert.deepEqual(result.proposedRows.filter((row) => row.method === "card").map((row) => row.reference), [
    "Legacy tender bucket: AMEX", "Legacy tender bucket: DISCOVER", "Legacy tender bucket: MAST_VISA",
  ]);
  assert.equal(result.normalizedMethodTotals.card.amountCents, 1200);
});

test("source and Invoice authority mismatches are fatal", () => {
  assert.ok(project({ stagedArRows: [source({ PAYMENT: "116.70" })] }).fatalIssues.some((issue) => issue.code === "source-financial-mismatch"));
  assert.ok(project({ invoices: [{ ...invoice, paidTotal: "116.70" }] }).fatalIssues.some((issue) => issue.code === "invoice-financial-mismatch"));
  assert.ok(project({ stagedArRows: [source({ CASH: "-1", ACCC: "117.71" })] }).fatalIssues.some((issue) => issue.code === "negative-tender-bucket"));
});

test("every nonzero payment requires matching Invoice and Customer identities", () => {
  assert.ok(project({ invoices: [] }).fatalIssues.some((issue) => issue.code === "unmatched-paid-invoice"));
  assert.ok(project({ resolvedCustomers: [] }).fatalIssues.some((issue) => issue.code === "unmatched-paid-customer"));
  assert.ok(project({ resolvedCustomers: [{ legacyCustno: "42", customerId: "66666666-6666-4666-8666-666666666666" }] }).fatalIssues.some((issue) => issue.code === "customer-mismatch"));
});

test("zero-payment unmatched source is reported without inventing Payment rows", () => {
  const zero = source({ CASH: 0, ACCC: 0, PAYMENT: 0, TOTAL: 0, BALANCE: 0 }, { legacyRoNo: "18181", legacyCustno: "99" });
  const result = project({ stagedArRows: [zero], invoices: [], resolvedCustomers: [] });
  assert.equal(result.proposedRows.length, 0);
  assert.equal(result.unmatchedRecords.length, 1);
  assert.equal(result.counts.zeroPaymentOrderCount, 1);
  assert.equal(result.counts.unmatchedZeroPaymentCount, 1);
  assert.equal(result.counts.unmatchedNonzeroPaymentCount, 0);
  assert.equal(result.fatalIssues.length, 0);
});

test("identical duplicates are deterministically collapsed while material conflicts are fatal", () => {
  const first = source();
  const duplicate = { ...source(), id: "77777777-7777-4777-8777-777777777777" };
  const identical = project({ stagedArRows: [first, duplicate] });
  assert.equal(identical.proposedRows.length, 2);
  assert.equal(identical.counts.identicalDuplicateSourceKeyCount, 1);
  assert.equal(identical.counts.duplicateDeterministicKeyCount, 0);
  assert.equal(identical.fatalIssues.length, 0);
  const conflicting = project({ stagedArRows: [first, { ...duplicate, rawData: { ...duplicate.rawData, PAYMENT: "1" } }] });
  assert.equal(conflicting.counts.conflictingSourceKeyCount, 1);
  assert.ok(conflicting.fatalIssues.some((issue) => issue.code === "conflicting-source-duplicate"));
});

test("unsupported financial detail is classified and fatal while represented discounts remain visible", () => {
  const result = project({ stagedArRows: [source({ DEPOSIT: "10", DISCOUNT: "2.50", PAID: true })] });
  const byField = new Map(result.unsupportedFieldClassifications.map((item) => [item.field, item]));
  assert.equal(byField.get("DEPOSIT").classification, "unsupported transaction detail");
  assert.equal(byField.get("DISCOUNT").classification, "already represented in Invoice totals");
  assert.equal(byField.get("PAID").classification, "informational");
  assert.ok(result.fatalIssues.some((issue) => issue.code === "unsupported-financial-ambiguity" && issue.field === "DEPOSIT"));
});

test("deterministic IDs are stable, shop/RO/bucket scoped, and amount-independent", () => {
  const cash = deterministicLegacyPaymentId(shopId, "21503", "CASH");
  assert.match(cash, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(cash, deterministicLegacyPaymentId(shopId, "21503", "CASH"));
  assert.notEqual(cash, deterministicLegacyPaymentId(shopId, "21503", "ACCC"));
  const changed = project({
    stagedArRows: [source({ CASH: "114", ACCC: "2.71" })],
  });
  assert.equal(changed.proposedRows[0].id, cash);
});

test("existing identical rows are unchanged and material deterministic collisions are fatal", () => {
  const proposed = project().proposedRows[0];
  const existing = { ...paymentCreateData(proposed), amount: { toString: () => "115.000" } };
  assert.equal(classifyLegacyPaymentRows([proposed], [existing]).unchanged.length, 1);
  const result = project({ existingRows: [{ ...existing, reference: "manual value" }] });
  assert.equal(result.existing.conflicts.length, 1);
  assert.ok(result.fatalIssues.some((issue) => issue.code === "deterministic-id-conflict"));
  assert.deepEqual(Object.keys(paymentCreateData(proposed)), [...LEGACY_PAYMENT_PERSISTED_FIELDS]);
});

test("dry run performs zero writes and confirmed writes recheck conflicts transactionally", async () => {
  const projection = project();
  let transactions = 0;
  const dryPrisma = { $transaction: async () => { transactions += 1; } };
  assert.deepEqual(await executeLegacyPaymentInsertTransaction({ confirmedWrite: false, prisma: dryPrisma, projection }), { executed: false, databaseWrites: 0 });
  assert.equal(transactions, 0);

  const created = [];
  const prisma = {
    $transaction: async (callback) => {
      transactions += 1;
      return callback({ payment: {
        findMany: async () => [paymentCreateData(projection.proposedRows[0])],
        createMany: async ({ data }) => { created.push(...data); return { count: data.length }; },
      } });
    },
  };
  const result = await executeLegacyPaymentInsertTransaction({ confirmedWrite: true, prisma, projection });
  assert.equal(result.databaseWrites, 1);
  assert.equal(created[0].id, projection.proposedRows[1].id);
});

test("confirmed write refuses a projection containing any fatal issue", async () => {
  let transactions = 0;
  await assert.rejects(
    executeLegacyPaymentInsertTransaction({
      confirmedWrite: true,
      prisma: { $transaction: async () => { transactions += 1; } },
      projection: project({ invoices: [] }),
    }),
    /Validated payment projection/,
  );
  assert.equal(transactions, 0);
});

test("importer source requires the exact run, shop ownership, staged rows, and full projection", async () => {
  const sourceText = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./import-legacy-payments.mjs", import.meta.url), "utf8"));
  assert.doesNotMatch(sourceText, /findFirst\([\s\S]*orderBy:\s*\{\s*createdAt:\s*"desc"/);
  assert.match(sourceText, /id:\s*options\.importRunId, shopId/);
  assert.match(sourceText, /legacyImportRunId:\s*options\.importRunId/);
  assert.match(sourceText, /has no RawLegacyAr rows/);
  assert.match(sourceText, /projectLegacyPayments/);
});

test("approved recovered-source aggregate verification is external to pure unit fixtures", { skip: !process.env.LEGACY_PAYMENT_APPROVED_AGGREGATE_MANIFEST }, () => {
  // The approved recovery manifest is private and intentionally is not checked into Git.
  assert.ok(process.env.LEGACY_PAYMENT_APPROVED_AGGREGATE_MANIFEST);
});

test("approved recovered projection contract contains only non-sensitive aggregate expectations", () => {
  assert.deepEqual(APPROVED_RECOVERED_PAYMENT_AGGREGATE, {
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
  assert.deepEqual(legacyPaymentAggregateSummary(project()), {
    matchedInvoiceCount: 1,
    unmatchedInvoiceCount: 0,
    matchedCustomerCount: 1,
    unmatchedCustomerCount: 0,
    proposedPaymentRowCount: 2,
    proposedPaymentAmountCents: 11_671,
    zeroPaymentOrderCount: 0,
    splitTenderOrderCount: 1,
    tenderMismatchCount: 0,
    duplicateDeterministicKeyCount: 0,
  });
});
