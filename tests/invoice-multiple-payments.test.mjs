import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyInvoicePayment, assertInvoiceCanClose, invoicePaymentSummary, paymentMethodLabel, paymentPayerLabel, paymentStatusLabel } from "../src/lib/invoice-payments.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("one exact payment produces Paid with zero balance without closing", () => {
  const result = applyInvoicePayment("200.00", "0", "200.00");
  assert.equal(result.paidTotal.toFixed(2), "200.00");
  assert.equal(result.balance.toFixed(2), "0.00");
  assert.equal(result.status, "paid");
});

test("partial and subsequent split payments preserve each running balance", () => {
  const first = applyInvoicePayment("1000", "0", "250");
  assert.deepEqual([first.paidTotal.toFixed(2), first.balance.toFixed(2), first.status], ["250.00", "750.00", "partially_paid"]);
  const second = applyInvoicePayment("1000", first.paidTotal, "750");
  assert.deepEqual([second.paidTotal.toFixed(2), second.balance.toFixed(2), second.status], ["1000.00", "0.00", "paid"]);
});

test("deductible then insurance payment and three-payer histories are cent exact", () => {
  const deductible = applyInvoicePayment("3000", "0", "500");
  const insurance = applyInvoicePayment("3000", deductible.paidTotal, "2500");
  assert.equal(deductible.balance.toFixed(2), "2500.00");
  assert.equal(insurance.balance.toFixed(2), "0.00");
  const one = applyInvoicePayment("800", "0", "100");
  const two = applyInvoicePayment("800", one.paidTotal, "200");
  const three = applyInvoicePayment("800", two.paidTotal, "500");
  assert.deepEqual([one.balance.toFixed(2), two.balance.toFixed(2), three.balance.toFixed(2)], ["700.00", "500.00", "0.00"]);
});

test("zero, negative, and overpayment are rejected with authoritative balance", () => {
  assert.throws(() => applyInvoicePayment("500", "0", "0"), /greater than/);
  assert.throws(() => applyInvoicePayment("500", "0", "-0.01"), /greater than/);
  assert.throws(() => applyInvoicePayment("500", "0", "501"), /remaining balance of \$500\.00/);
  assert.throws(() => applyInvoicePayment("500", "200", "301"), /remaining balance of \$300\.00/);
});

test("currency boundaries remain Decimal exact", () => {
  const first = applyInvoicePayment("0.03", "0", "0.01");
  const second = applyInvoicePayment("0.03", first.paidTotal, "0.02");
  assert.equal(first.balance.toFixed(2), "0.02");
  assert.equal(second.balance.toFixed(2), "0.00");
});

test("closing rejects no payment and partial payment but permits exactly zero balance", () => {
  assert.throws(() => assertInvoiceCanClose("500", "0"), /\$500\.00 remains unpaid/);
  assert.throws(() => assertInvoiceCanClose("500", "200"), /\$300\.00 remains unpaid/);
  assert.doesNotThrow(() => assertInvoiceCanClose("500", "500"));
});

test("derived payment labels distinguish unpaid, partial, and paid", () => {
  assert.equal(paymentStatusLabel(invoicePaymentSummary("10", "0").status), "Unpaid");
  assert.equal(paymentStatusLabel(invoicePaymentSummary("10", "1").status), "Partially Paid");
  assert.equal(paymentStatusLabel(invoicePaymentSummary("10", "10").status), "Paid");
  assert.equal(paymentPayerLabel("INSURANCE"), "Insurance");
  assert.equal(paymentPayerLabel("WARRANTY"), "Warranty Company");
  assert.equal(paymentMethodLabel("debit_card"), "Debit Card");
  assert.equal(paymentMethodLabel("ach_eft"), "ACH/EFT");
});

test("payment action is Shop-scoped, serialized, persisted-sum authoritative, and synchronizes Invoice and AR", async () => {
  const action = await read("src/app/(app)/invoices/payment-actions.ts");
  assert.match(action, /shop_id = \$\{membership\.shopId\}::uuid[\s\S]*FOR UPDATE/);
  assert.match(action, /status: "open"/);
  assert.match(action, /legacySourceTable: null/);
  assert.match(action, /payment\.aggregate\([\s\S]*invoiceId: invoice\.id, shopId: membership\.shopId/);
  assert.match(action, /applyInvoicePayment\(invoice\.total, existingPaid, amount\)/);
  assert.match(action, /invoice\.update\([\s\S]*paidTotal: applied\.paidTotal/);
  assert.match(action, /accountReceivable\.update\([\s\S]*balance: applied\.balance/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.doesNotMatch(action, /formData\.get\("(?:balance|paidTotal|shopId)"\)/);
});

test("final payment never closes and close remains explicit with a zero-balance server gate", async () => {
  const [payment, lifecycle] = await Promise.all([read("src/app/(app)/invoices/payment-actions.ts"), read("src/app/(app)/invoices/lifecycle-actions.ts")]);
  assert.doesNotMatch(payment, /status:\s*"closed"|closedAt|closeInvoice/);
  assert.match(lifecycle, /closeInvoice[\s\S]*payment\.aggregate[\s\S]*assertInvoiceCanClose/);
  assert.match(lifecycle, /data: \{ status: "closed", closedAt: now/);
  assert.doesNotMatch(lifecycle, /data: \{ status: "closed", paidTotal:/);
});

test("UI defaults each new payment to current AR balance and displays payer, history, and payment status", async () => {
  const [page, form] = await Promise.all([read("src/app/(app)/invoices/[id]/page.tsx"), read("src/components/invoice-payment-form.tsx")]);
  assert.match(page, /paymentAmount = receivable\?\.balance\.toFixed\(2\)/);
  assert.match(page, /key=\{paymentAmount\}/);
  assert.match(form, /defaultValue=\{remainingBalance\}/);
  assert.match(form, /name="payerType"[\s\S]*CUSTOMER/);
  assert.match(form, /name="reference"/);
  assert.match(form, /name="note"/);
  assert.match(page, /paymentStatusLabel/);
  assert.match(page, /paymentPayerLabel\(payment\.payerType\)/);
});

test("migration is additive, preserves financials, and classifies unproven legacy payer as Other", async () => {
  const [schema, migration] = await Promise.all([read("prisma/schema.prisma"), read("prisma/migrations/20260828190000_add_payment_payer_metadata/migration.sql")]);
  assert.match(schema, /payerType\s+PaymentPayerType\s+@default\(CUSTOMER\)/);
  assert.match(schema, /note\s+String\?\s+@db\.Text/);
  assert.match(migration, /ADD COLUMN "payer_type"[\s\S]*DEFAULT 'CUSTOMER'/);
  assert.match(migration, /UPDATE "payments"[\s\S]*SET "payer_type" = 'OTHER'/);
  assert.doesNotMatch(migration, /UPDATE "invoices"|UPDATE "accounts_receivable"|"paid_total"|"balance"|"amount"\s*=/i);
});

test("legacy refresh preserves migrations and projects payment metadata without inventing payer identity", async () => {
  const [projection, reset, rehearsal] = await Promise.all([read("scripts/lib/legacy-payment-import.mjs"), read("scripts/lib/legacy-cutover-reset.mjs"), read("scripts/lib/legacy-refresh-rehearsal.mjs")]);
  assert.match(projection, /payerType: "OTHER"/);
  assert.match(projection, /"payerType", "reference", "note"/);
  assert.match(reset, /\["payments", "payment"\]/);
  assert.doesNotMatch(reset, /_prisma_migrations|migration/i);
  assert.match(rehearsal, /prisma migrate deploy is required before a confirmed cutover/);
});

test("legacy and closed invoices remain read-only while reports keep closed-native authority", async () => {
  const [payment, reportable] = await Promise.all([read("src/app/(app)/invoices/payment-actions.ts"), read("src/lib/reportable-sales.ts")]);
  assert.match(payment, /legacySourceTable: null/);
  assert.match(payment, /status: "open"/);
  assert.match(reportable, /legacySourceTable: null,\s*status: "closed"/);
  assert.match(reportable, /closedAt/);
});
