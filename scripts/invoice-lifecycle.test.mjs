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
  const totals = calculateEditableInvoiceTotals({ parts: [{ quantity: "2", unitPrice: "10.10" }], labor: [{ hours: "1.5", hourlyRate: "100" }], shopSuppliesAmount: "5", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true });
  assert.equal(totals.partsTotal.toFixed(2), "20.20");
  assert.equal(totals.laborTotal.toFixed(2), "150.00");
  assert.equal(totals.taxTotal.toFixed(2), "1.51");
  assert.equal(totals.total.toFixed(2), "176.71");
  assert.equal(invoiceBalance(totals.total, new Prisma.Decimal("76.71")).toFixed(2), "100.00");
});

test("invoice creation is locked, unique, idempotent, and creates OPEN", async () => {
  const [schema, action] = await Promise.all([read("prisma/schema.prisma"), read("src/app/(app)/repair-orders/finalize-actions.ts")]);
  assert.match(schema, /@@unique\(\[repairOrderId\]\)/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.match(action, /const existingInvoice[\s\S]*if \(existingInvoice\) return existingInvoice/);
  assert.match(action, /status: "open"/);
  assert.match(action, /redirect\(`\/invoices\/\$\{invoice\.id\}`\)/);
  assert.doesNotMatch(action, /status: "finalized"/);
});

test("payment completion does not close an invoice", async () => {
  const payment = await read("src/app/(app)/invoices/payment-actions.ts");
  assert.match(payment, /status: "open"/);
  assert.match(payment, /data: \{ paidTotal \}/);
  assert.match(payment, /invoice\.update\(\{[\s\S]*?data: \{ paidTotal \}/);
});

test("invoice edits are transactional, OPEN-only, preserve payments, and refresh AR", async () => {
  const action = await read("src/app/(app)/invoices/lifecycle-actions.ts");
  assert.match(action, /status: "open", legacySourceTable: null/g);
  assert.match(action, /payment\.aggregate/);
  assert.match(action, /accountReceivable\.update/);
  assert.match(action, /Invoice changes cannot reduce the total below payments already received/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.doesNotMatch(action, /payment\.(?:delete|update)/);
});

test("close requires zero balance, delivery, OPEN state, and OWNER or ADMIN", async () => {
  const [action, dialog] = await Promise.all([read("src/app/(app)/invoices/lifecycle-actions.ts"), read("src/components/close-invoice-button.tsx")]);
  assert.match(action, /vehicleDelivered/);
  assert.match(action, /\["OWNER", "ADMIN"\]/);
  assert.match(action, /if \(!balance\.isZero\(\)\) throw/);
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
  const pages = (await Promise.all([read("src/app/(app)/repair-orders/[id]/page.tsx"), read("src/app/(app)/repair-orders/[id]/create-invoice/page.tsx")])).join("\n");
  assert.match(pages, />Create Invoice</);
  assert.doesNotMatch(pages, /Finalize\s*\/\s*Create Invoice|Finalize and create invoice/);
  assert.match(pages, /Open Invoice/);
});
