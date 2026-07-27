import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEGACY_PAYMENT_DATE_LABEL,
  LEGACY_PAYMENT_DATE_POLICY,
  parsePaymentDatePolicyArgument,
  projectLegacyPayments,
} from "./lib/legacy-payment-import.mjs";
import {
  loadLegacyPaymentStageProjection,
  runPaymentBeforeOpenOrders,
  validateApprovedPaymentUnresolved,
  verifyPersistedLegacyPayments,
} from "./lib/legacy-payment-stage.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const importRunId = "44444444-4444-4444-8444-444444444444";
const customerId = "33333333-3333-4333-8333-333333333333";
const invoiceId = "22222222-2222-4222-8222-222222222222";

function stagedAr(payment = "40", total = "100", balance = "60") {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    shopId,
    legacyImportRunId: importRunId,
    legacyRoNo: "21503",
    legacyCustno: "42",
    rawData: {
      CASH: payment, CHECK: "0", AMEX: "0", DISCOVER: "0", MAST_VISA: "0", ACCC: "0", ACCOUNT: "0",
      PAYMENT: payment, TOTAL: total, BALANCE: balance, DEPOSIT: "0", RECVD: "0", DIFF: "0", DIFF2: "0",
      DIFF3: "0", DISCOUNT: "0", DEDUCT: "0", PAID: false, CPAID: false, DELETE: false, COLLT: false,
      BADDEBT: false, COLDATE: null, DEBTDATE: null,
    },
  };
}

function invoice(payment = "40", total = "100") {
  return { id: invoiceId, shopId, legacyRoNo: "21503", customerId, invoiceDate: new Date("2026-01-15T00:00:00Z"), paidTotal: payment, total };
}

function projection(payment = "40", total = "100", balance = "60") {
  return projectLegacyPayments({
    shopId, importRunId, stagedArRows: [stagedAr(payment, total, balance)], invoices: [invoice(payment, total)],
    resolvedCustomers: [{ legacyCustno: "42", customerId, resolutionType: "normal" }],
    paymentDatePolicy: LEGACY_PAYMENT_DATE_POLICY,
  });
}

test("cutover payment policy is mandatory, singular, and limited to the Invoice-date proxy", () => {
  assert.equal(parsePaymentDatePolicyArgument(["--payment-date-policy", LEGACY_PAYMENT_DATE_POLICY]), LEGACY_PAYMENT_DATE_POLICY);
  assert.throws(() => parsePaymentDatePolicyArgument([]), /exactly once/);
  assert.throws(() => parsePaymentDatePolicyArgument(["--payment-date-policy", LEGACY_PAYMENT_DATE_POLICY, "--payment-date-policy", LEGACY_PAYMENT_DATE_POLICY]), /exactly once/);
  assert.throws(() => parsePaymentDatePolicyArgument(["--payment-date-policy", "receipt-date"]), /must equal invoice-date-proxy/);
});

test("the exact Invoice/AR run and shop are required by the programmatic stage", async () => {
  const calls = [];
  const prisma = {
    legacyImportRun: { findFirst: async ({ where }) => { calls.push(where); return null; } },
  };
  await assert.rejects(loadLegacyPaymentStageProjection({ prisma, shopId, importRunId, paymentDatePolicy: LEGACY_PAYMENT_DATE_POLICY }), /import-run mismatch/);
  assert.deepEqual(calls, [{ id: importRunId, shopId, rawAr: { some: {} } }]);
});

test("dry projection supports partial and zero payments without writes", () => {
  const partial = projection();
  assert.equal(partial.fatalIssues.length, 0);
  assert.equal(partial.proposedPaymentAmountCents, 4_000);
  assert.equal(partial.counts.partialPaymentOrderCount, 1);
  const zero = projection("0", "100", "100");
  assert.equal(zero.fatalIssues.length, 0);
  assert.equal(zero.proposedRows.length, 0);
  assert.equal(zero.counts.zeroPaymentOrderCount, 1);
  assert.equal(partial.label, LEGACY_PAYMENT_DATE_LABEL);
});

test("approved unresolved zero payments remain explicit while nonzero and unexpected records are fatal", () => {
  const unmatchedZero = projectLegacyPayments({
    shopId, importRunId, stagedArRows: [{ ...stagedAr("0", "0", "0"), legacyRoNo: "18181", legacyCustno: "99" }],
    invoices: [], resolvedCustomers: [], paymentDatePolicy: LEGACY_PAYMENT_DATE_POLICY,
  });
  const recoveryPlan = { unresolvedEntries: [{ legacyRoNo: "18181", legacyCustno: "99" }] };
  assert.equal(validateApprovedPaymentUnresolved({ projection: unmatchedZero, recoveryPlan }).fatalIssues.length, 0);
  assert.ok(validateApprovedPaymentUnresolved({ projection: unmatchedZero, recoveryPlan: null }).fatalIssues.some((issue) => issue.code === "unexpected-unresolved-payment"));
});

test("persisted verification detects Payment sums, AR balances, and unexpected deterministic rows", () => {
  const projected = projection();
  const valid = verifyPersistedLegacyPayments({
    projection: projected,
    persistedPayments: [{ ...projected.proposedRows[0], invoiceId, amount: "40.00" }],
    accountsReceivable: [{ invoiceId, balance: "60.00" }],
  });
  assert.equal(valid.fatalIssues.length, 0);
  const invalid = verifyPersistedLegacyPayments({
    projection: projected,
    persistedPayments: [{ id: "99999999-9999-4999-8999-999999999999", invoiceId, amount: "39.00" }],
    accountsReceivable: [{ invoiceId, balance: "60.00" }],
  });
  assert.ok(invalid.fatalIssues.some((issue) => issue.code === "persisted-payment-sum-mismatch"));
  assert.ok(invalid.fatalIssues.some((issue) => issue.code === "unexpected-persisted-payment"));
});

test("Payment failure blocks open Repair Order staging", async () => {
  let openOrders = 0;
  await assert.rejects(runPaymentBeforeOpenOrders({
    runPayment: async () => { throw new Error("payment failed"); },
    runOpenOrders: async () => { openOrders += 1; },
  }), /payment failed/);
  assert.equal(openOrders, 0);
});

test("cutover orders exact-run Payment integration before open orders without shelling to the standalone importer", async () => {
  const source = await readFile("scripts/legacy-cutover.mjs", "utf8");
  const invoiceStage = source.indexOf('runScriptWithOutput("import-invoices.mjs"');
  const invoiceTransform = source.indexOf('runScriptWithOutput("transform-invoices.mjs"');
  const paymentStage = source.indexOf("loadLegacyPaymentStageProjection({ prisma, shopId, importRunId: invoiceImportRunId");
  const openOrders = source.indexOf('runScript("import-open-orders.mjs"');
  assert.ok(invoiceStage > 0 && invoiceTransform > invoiceStage && paymentStage > invoiceTransform && openOrders > paymentStage);
  assert.match(source, /transformedRunId !== invoiceImportRunId/);
  assert.match(source, /runPaymentBeforeOpenOrders/);
  assert.doesNotMatch(source, /runScript(?:WithOutput)?\("import-legacy-payments\.mjs"/);
  assert.match(source, /reportBasis:\s*LEGACY_PAYMENT_DATE_LABEL/);
});
