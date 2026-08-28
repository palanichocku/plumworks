import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateEditableInvoiceTotals, invoiceBalance, isEditableOpenInvoice } from "../src/lib/invoice-lifecycle.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("only explicit nonlegacy OPEN invoices are editable", () => {
  assert.equal(isEditableOpenInvoice({ status: "open", legacySourceTable: null }), true);
  assert.equal(isEditableOpenInvoice({ status: "closed", legacySourceTable: null }), false);
  assert.equal(isEditableOpenInvoice({ status: "paid", legacySourceTable: "ar.DBF" }), false);
  assert.equal(isEditableOpenInvoice({ status: "open", legacySourceTable: "ar.DBF" }), false);
});

test("invoice recalculation and balance remain Decimal exact", () => {
  const totals = calculateEditableInvoiceTotals({ parts: [{ quantity: "2", unitPrice: "10.10" }], labor: [{ hours: "1.5", hourlyRate: "100" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "5", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(totals.partsTotal.toFixed(2), "20.20");
  assert.equal(totals.laborTotal.toFixed(2), "150.00");
  assert.equal(totals.shopSuppliesAmount.toFixed(2), "5.00");
  assert.equal(totals.taxTotal.toFixed(2), "1.93");
  assert.equal(totals.total.toFixed(2), "177.13");
  assert.equal(invoiceBalance(totals.total, new Prisma.Decimal("77.13")).toFixed(2), "100.00");
});

test("native Invoice discount prorates across Parts and Labor before tax", () => {
  const totals = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "100" }], labor: [{ hours: "1", hourlyRate: "100" }], discountAmount: "20", shopSuppliesEnabled: false, shopSuppliesRate: "0", shopSuppliesCap: "0", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(totals.partsDiscount.toFixed(2), "10.00");
  assert.equal(totals.laborDiscount.toFixed(2), "10.00");
  assert.equal(totals.taxTotal.toFixed(2), "5.40");
  assert.equal(totals.total.toFixed(2), "185.40");
});

test("discount proration assigns the cent-exact remainder to Labor", () => {
  const totals = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "100" }], labor: [{ hours: "1", hourlyRate: "50" }], discountAmount: "10", shopSuppliesEnabled: false, shopSuppliesRate: "0", shopSuppliesCap: "0", taxRate: "0", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(totals.partsDiscount.toFixed(2), "6.67");
  assert.equal(totals.laborDiscount.toFixed(2), "3.33");
  assert.equal(totals.partsDiscount.plus(totals.laborDiscount).toFixed(2), "10.00");
});

test("discount excludes Shop Supplies allocation and preserves pre-cap supplies taxation", () => {
  const totals = calculateEditableInvoiceTotals({ parts: [{ quantity: "1", unitPrice: "100" }], labor: [{ hours: "1", hourlyRate: "100" }], discountAmount: "20", shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "5", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(totals.shopSuppliesAmount.toFixed(2), "5.00");
  assert.equal(totals.taxTotal.toFixed(2), "5.88");
  assert.equal(totals.total.toFixed(2), "190.88");
});

test("discount boundaries fail safely", () => {
  const base = { parts: [{ quantity: "1", unitPrice: "10" }], labor: [], shopSuppliesEnabled: false, shopSuppliesRate: "0", shopSuppliesCap: "0", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true };
  assert.throws(() => calculateEditableInvoiceTotals({ ...base, discountAmount: "-0.01" }), /negative/);
  assert.throws(() => calculateEditableInvoiceTotals({ ...base, discountAmount: "10.01" }), /exceed Parts and Labor/);
  const full = calculateEditableInvoiceTotals({ ...base, discountAmount: "10" });
  assert.equal(full.taxTotal.toFixed(2), "0.00");
  assert.equal(full.total.toFixed(2), "0.00");
  const suppliesRemain = calculateEditableInvoiceTotals({ ...base, parts: [], labor: [{ hours: "1", hourlyRate: "100" }], discountAmount: "100", shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "5", shopSuppliesTaxable: true });
  assert.equal(suppliesRemain.shopSuppliesAmount.toFixed(2), "5.00");
  assert.equal(suppliesRemain.taxTotal.toFixed(2), "0.48");
  assert.equal(suppliesRemain.total.toFixed(2), "5.48");
});

test("discount taxability covers Parts-only, Labor-only, both, and neither", () => {
  const common = { shopSuppliesEnabled: false, shopSuppliesRate: "0", shopSuppliesCap: "0", taxRate: "0.06", shopSuppliesTaxable: true, discountAmount: "10" };
  const parts = calculateEditableInvoiceTotals({ ...common, parts: [{ quantity: "1", unitPrice: "100" }], labor: [], partsTaxable: true, laborTaxable: false });
  assert.equal(parts.partsDiscount.toFixed(2), "10.00"); assert.equal(parts.taxTotal.toFixed(2), "5.40");
  const labor = calculateEditableInvoiceTotals({ ...common, parts: [], labor: [{ hours: "1", hourlyRate: "100" }], partsTaxable: false, laborTaxable: true });
  assert.equal(labor.laborDiscount.toFixed(2), "10.00"); assert.equal(labor.taxTotal.toFixed(2), "5.40");
  const both = calculateEditableInvoiceTotals({ ...common, parts: [{ quantity: "1", unitPrice: "50" }], labor: [{ hours: "1", hourlyRate: "50" }], partsTaxable: true, laborTaxable: true });
  assert.equal(both.taxTotal.toFixed(2), "5.40");
  const neither = calculateEditableInvoiceTotals({ ...common, parts: [{ quantity: "1", unitPrice: "50" }], labor: [{ hours: "1", hourlyRate: "50" }], partsTaxable: false, laborTaxable: false });
  assert.equal(neither.taxTotal.toFixed(2), "0.00");
});

test("RO to Invoice eligibility survives conversion and later recalculation", async () => {
  const input = { parts: [], labor: [{ hours: "3", hourlyRate: "100", shopSuppliesEligible: true }, { hours: "1", hourlyRate: "145", shopSuppliesEligible: false }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "20", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true };
  const before = calculateEditableInvoiceTotals(input);
  const after = calculateEditableInvoiceTotals({ ...input, labor: input.labor.map((line) => ({ ...line })) });
  assert.deepEqual(after, before);
  assert.equal(after.shopSuppliesEligibleLaborTotal.toFixed(2), "300.00");
  const action = await read("src/app/(app)/repair-orders/finalize-actions.ts");
  assert.match(action, /labor: \{ orderBy:[\s\S]*shopSuppliesEligible: true/);
  assert.match(action, /shopSuppliesEligible: line\.shopSuppliesEligible/);
});

test("invoice creation is locked, unique, idempotent, and creates OPEN", async () => {
  const [schema, action] = await Promise.all([read("prisma/schema.prisma"), read("src/app/(app)/repair-orders/finalize-actions.ts")]);
  assert.match(schema, /@@unique\(\[repairOrderId\]\)/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.match(action, /const existingInvoice[\s\S]*shopId: membership\.shopId[\s\S]*if \(existingInvoice\) return existingInvoice/);
  assert.match(action, /status: "open"/);
  assert.match(action, /redirect\(`\/invoices\/\$\{invoice\.id\}`\)/);
  assert.doesNotMatch(action, /status: "finalized"/);
});

test("payment completion does not close an invoice", async () => {
  const payment = await read("src/app/(app)/invoices/payment-actions.ts");
  assert.match(payment, /status: "open"/);
  assert.match(payment, /paidTotal: applied\.paidTotal/);
  assert.match(payment, /invoice\.update\(\{[\s\S]*?paidTotal: applied\.paidTotal/);
});

test("invoice edits are transactional, OPEN-only, preserve payments, and refresh AR", async () => {
  const action = await read("src/app/(app)/invoices/lifecycle-actions.ts");
  assert.match(action, /status: "open", legacySourceTable: null/g);
  assert.match(action, /payment\.aggregate/);
  assert.match(action, /accountReceivable\.update/);
  assert.match(action, /Invoice changes cannot reduce the total below payments already received/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.doesNotMatch(action, /payment\.(?:delete|update)/);
  assert.match(action, /updateInvoiceDetails[\s\S]*mutateOpenInvoice/);
  for (const mutation of ["addInvoicePart", "updateInvoicePart", "deleteInvoicePart", "addInvoiceLabor", "updateInvoiceLabor", "deleteInvoiceLabor"]) {
    assert.match(action, new RegExp(`export async function ${mutation}\\([\\s\\S]*?mutateOpenInvoice`));
  }
  assert.match(action, /previewInvoiceEditTotals[\s\S]*calculateEditableInvoiceTotals/);
  assert.match(action, /async function refreshInvoice[\s\S]*calculateEditableInvoiceTotals/);
  assert.match(action, /await refreshInvoice\(transaction, membership\.shopId, invoiceId\)/);
  assert.match(action, /discountAmount: invoice\.discountAmount/);
  assert.match(action, /updateInvoiceDiscount[\s\S]*mutateOpenInvoice/);
  assert.match(action, /money\(formData\.get\("discountAmount"\)\)/);
  assert.doesNotMatch(action, /formData\.get\("(?:partsDiscount|laborDiscount|taxTotal|total)"\)/);
  assert.doesNotMatch(action, /formData\.get\("(?:partsTotal|laborTotal|shopSuppliesAmount|taxTotal|total)"\)/);
});

test("Invoice discount migration is additive and zero-defaulted", async () => {
  const [schema, migration] = await Promise.all([read("prisma/schema.prisma"), read("prisma/migrations/20260820120000_add_invoice_discount_amount/migration.sql")]);
  assert.match(schema, /discountAmount\s+Decimal\s+@default\(0\)\s+@map\("discount_amount"\)\s+@db\.Decimal\(12, 2\)/);
  assert.match(migration, /ADD COLUMN "discount_amount" DECIMAL\(12,2\) NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP/i);
});

test("Invoice customer documents display a nonzero Discount explicitly", async () => {
  const sources = (await Promise.all([read("src/lib/invoice-document.ts"), read("src/components/invoice-document-html.tsx"), read("src/components/pdf/invoice-document-pdf.tsx")])).join("\n");
  assert.match(sources, /discountAmount/);
  assert.match(sources, /label="Discount"/);
  assert.match(sources, />Discount</);
});

test("close requires zero balance, delivery, OPEN state, and OWNER or ADMIN", async () => {
  const [action, dialog] = await Promise.all([read("src/app/(app)/invoices/lifecycle-actions.ts"), read("src/components/close-invoice-button.tsx")]);
  assert.match(action, /vehicleDelivered/);
  assert.match(action, /\["OWNER", "ADMIN"\]/);
  assert.match(action, /closeInvoice[\s\S]*refreshInvoice\(transaction, membership\.shopId, invoiceId\)[\s\S]*assertInvoiceCanClose/);
  assert.match(action, /status: "closed"/);
  assert.match(action, /closedAt: now, deliveredAt: now, closedByUserId/);
  assert.match(dialog, /name="vehicleDelivered"/);
  assert.match(dialog, /Close this invoice\?/);
  assert.doesNotMatch(action + dialog, /Reopen Invoice/);
});

test("schema migration is additive and leaves historical statuses untouched", async () => {
  const migration = await read("prisma/migrations/20260720230000_add_invoice_lifecycle/migration.sql");
  assert.match(migration, /ADD COLUMN "closed_at"/);
  assert.match(migration, /ADD COLUMN "delivered_at"/);
  assert.match(migration, /ADD COLUMN "closed_by_user_id"/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP|DEFAULT/i);
});

test("visible creation wording is Create Invoice and no Finalize/Create label remains", async () => {
  const pages = (await Promise.all([read("src/app/(app)/repair-orders/[id]/page.tsx"), read("src/components/repair-order-concerns-form.tsx")])).join("\n");
  assert.match(pages, /"Create Invoice"/);
  assert.doesNotMatch(pages, /Finalize\s*\/\s*Create Invoice|Finalize and create invoice/);
  assert.match(pages, /Open Invoice/);
});
