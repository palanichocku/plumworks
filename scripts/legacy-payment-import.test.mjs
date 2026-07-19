import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLegacyPaymentRows,
  deterministicLegacyPaymentId,
  executeLegacyPaymentInsertTransaction,
  LEGACY_PAYMENT_PERSISTED_FIELDS,
  parseLegacyPaymentImportArguments,
  paymentCreateData,
  planLegacyPaymentOrder,
} from "./lib/legacy-payment-import.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const invoice = {
  id: "22222222-2222-4222-8222-222222222222",
  customerId: "33333333-3333-4333-8333-333333333333",
  invoiceDate: new Date("2026-01-15T00:00:00.000Z"),
  paidTotal: "116.71",
  total: "116.71",
};

function source(overrides = {}) {
  return {
    legacyRoNo: "21503",
    rawData: {
      CASH: "115.00", CHECK: "", AMEX: null, DISCOVER: "0", MAST_VISA: "0.00",
      ACCOUNT: null, ACCC: "1.71", PAYMENT: "116.71", BALANCE: null, TOTAL: "116.71",
      ...overrides,
    },
  };
}

test("argument safety defaults to dry run and accepts only the exact confirmation", () => {
  assert.equal(parseLegacyPaymentImportArguments([]).dryRun, true);
  assert.equal(parseLegacyPaymentImportArguments(["--dry-run"]).dryRun, true);
  assert.equal(parseLegacyPaymentImportArguments(["--shop-id", shopId]).dryRun, true);
  assert.equal(parseLegacyPaymentImportArguments(["--confirm", "IMPORT_LEGACY_PAYMENTS"]).confirmedWrite, true);
  assert.throws(() => parseLegacyPaymentImportArguments(["--confirm", "WRONG"]), /must equal/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--confirm"]), /requires a value/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--confirm", "IMPORT_LEGACY_PAYMENTS", "--confirm", "IMPORT_LEGACY_PAYMENTS"]), /Duplicate/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--dry-run", "--confirm", "IMPORT_LEGACY_PAYMENTS"]), /cannot be combined/);
  assert.throws(() => parseLegacyPaymentImportArguments(["--write"]), /Unknown/);
});

test("deterministic UUID identity is stable, bucket-specific, and amount-independent", () => {
  const cash = deterministicLegacyPaymentId(shopId, "21503", "CASH");
  assert.match(cash, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(cash, deterministicLegacyPaymentId(shopId, "21503", "CASH"));
  assert.notEqual(cash, deterministicLegacyPaymentId(shopId, "21503", "ACCC"));
  const changedAmounts = planLegacyPaymentOrder({
    shopId,
    source: source({ CASH: "114.00", ACCC: "2.71" }),
    invoice,
  });
  assert.equal(changedAmounts.rows[0].id, cash);
});

test("January RO 21503 creates cash and internal rows and omits zero buckets", () => {
  const plan = planLegacyPaymentOrder({ shopId, source: source(), invoice });
  assert.equal(plan.tenderReconciles, true);
  assert.equal(plan.invoiceReconciles, true);
  assert.deepEqual(plan.rows.map(({ method, amount, reference }) => ({ method, amount, reference })), [
    { method: "cash", amount: "115.00", reference: "Legacy tender bucket: CASH" },
    { method: "internal", amount: "1.71", reference: "Legacy tender bucket: ACCC" },
  ]);
});

test("every authoritative source bucket maps to its required method and reference", () => {
  const fields = ["CASH", "CHECK", "AMEX", "DISCOVER", "MAST_VISA", "ACCC", "ACCOUNT"];
  const expected = ["cash", "check", "card", "card", "card", "internal", "other"];
  for (let index = 0; index < fields.length; index += 1) {
    const zeros = Object.fromEntries(fields.map((field) => [field, "0"]));
    const rawData = { ...zeros, [fields[index]]: "1.00", PAYMENT: "1.00", TOTAL: "1.00", BALANCE: "0" };
    const plan = planLegacyPaymentOrder({ shopId, source: { legacyRoNo: "9", rawData }, invoice: { ...invoice, paidTotal: "1", total: "1" } });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].method, expected[index]);
    assert.equal(plan.rows[0].reference, `Legacy tender bucket: ${fields[index]}`);
  }
});

test("tender-sum and operational invoice mismatches are detected", () => {
  assert.equal(planLegacyPaymentOrder({ shopId, source: source({ PAYMENT: "116.70" }), invoice }).tenderReconciles, false);
  assert.equal(planLegacyPaymentOrder({ shopId, source: source(), invoice: { ...invoice, paidTotal: "116.70" } }).invoiceReconciles, false);
});

test("RO 18181 without an operational invoice remains unmatched and proposes no payment", () => {
  const plan = planLegacyPaymentOrder({
    shopId,
    source: { legacyRoNo: "18181", rawData: { CASH: 0, CHECK: 0, AMEX: 0, DISCOVER: 0, MAST_VISA: 0, ACCOUNT: 0, ACCC: 0, PAYMENT: 0, TOTAL: 0, BALANCE: null } },
    invoice: null,
  });
  assert.equal(plan.matched, false);
  assert.deepEqual(plan.rows, []);
  assert.equal(plan.tenderReconciles, true);
});

test("identical persisted fields are unchanged and a deterministic collision conflicts", () => {
  const proposed = planLegacyPaymentOrder({ shopId, source: source(), invoice }).rows[0];
  const existing = { ...paymentCreateData(proposed), amount: { toString: () => "115.000" } };
  assert.equal(classifyLegacyPaymentRows([proposed], [existing]).unchanged.length, 1);
  const conflict = { ...existing, reference: "manual value" };
  assert.equal(classifyLegacyPaymentRows([proposed], [conflict]).conflicts.length, 1);
  assert.deepEqual(Object.keys(paymentCreateData(proposed)), [...LEGACY_PAYMENT_PERSISTED_FIELDS]);
});

test("dry run performs zero writes and never enters a transaction", async () => {
  let transactions = 0;
  const prisma = { $transaction: async () => { transactions += 1; } };
  const result = await executeLegacyPaymentInsertTransaction({ confirmedWrite: false, prisma, proposedRows: [{}] });
  assert.equal(transactions, 0);
  assert.deepEqual(result, { executed: false, databaseWrites: 0 });
});

test("confirmed inserts use exactly one transaction and exclude unchanged rows", async () => {
  const rows = planLegacyPaymentOrder({ shopId, source: source(), invoice }).rows;
  let transactions = 0;
  const created = [];
  const prisma = {
    $transaction: async (callback) => {
      transactions += 1;
      return callback({
        payment: {
          findMany: async () => [paymentCreateData(rows[0])],
          createMany: async ({ data }) => { created.push(...data); return { count: data.length }; },
        },
      });
    },
  };
  const result = await executeLegacyPaymentInsertTransaction({ confirmedWrite: true, prisma, proposedRows: rows });
  assert.equal(transactions, 1);
  assert.equal(result.databaseWrites, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].id, rows[1].id);
});
