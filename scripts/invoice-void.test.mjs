import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url); const read = (path) => readFile(new URL(path, root), "utf8");

test("void metadata migration is additive and preserves financial columns", async () => {
  const [schema, migration] = await Promise.all([read("prisma/schema.prisma"), read("prisma/migrations/20260903120000_add_invoice_void_metadata/migration.sql")]);
  for (const field of ["voidedAt", "voidedByUserId", "voidReason", "voidNote"]) assert.match(schema, new RegExp(field));
  assert.match(migration, /ADD COLUMN "voided_at"/); assert.doesNotMatch(migration, /UPDATE|DELETE|DROP|subtotal|tax_total|total/);
});

test("eligible void is locked, shop scoped, native, open, unpaid, and serializable", async () => {
  const action = await read("src/app/(app)/invoices/void-actions.ts");
  assert.match(action, /requirePermission\("finalize_repair_order"\)/); assert.match(action, /FOR UPDATE/); assert.match(action, /shopId: membership\.shopId/);
  assert.match(action, /legacySourceTable !== null/); assert.match(action, /current\.status !== "open"/); assert.match(action, /transaction\.payment\.aggregate/);
  assert.match(action, /payments\._count\._all > 0/); assert.match(action, /isolationLevel: "Serializable"/);
});

test("void stores status and metadata while preserving invoice amounts, lines, and relationships", async () => {
  const action = await read("src/app/(app)/invoices/void-actions.ts");
  const update = action.match(/transaction\.invoice\.update\([^\n]+/)?.[0] ?? "";
  assert.match(update, /status: "void"/); assert.match(update, /voidedAt/); assert.match(update, /voidedByUserId/); assert.match(update, /voidReason/);
  assert.doesNotMatch(update, /subtotal|taxTotal|total:|parts|labor|customerId|vehicleId|repairOrderId|closedAt/);
});

test("void zeroes and inactivates AR without representing payment", async () => {
  const action = await read("src/app/(app)/invoices/void-actions.ts");
  assert.match(action, /accountReceivable\.updateMany[\s\S]*balance: 0, status: "void"/);
  assert.doesNotMatch(action, /payment\.create/);
});

test("invalid reasons, OTHER without note, legacy, closed, paid, double void, and cross-shop calls fail", async () => {
  const [action, shared] = await Promise.all([read("src/app/(app)/invoices/void-actions.ts"), read("src/lib/invoice-void.ts")]);
  assert.match(action, /validateInvoiceVoidInput\(invoiceId, reason, note\)/); assert.match(shared, /reasons\.has\(reason\)/); assert.match(shared, /reason === "OTHER" && note\.length < 3/);
  assert.match(action, /Historical imported invoices cannot be voided/); assert.match(action, /closed invoice cannot use/); assert.match(action, /already been voided/);
  assert.match(action, /payments recorded and cannot be voided/); assert.match(action, /Invoice was not found for this Shop/);
});

test("use-server module exports only an async action and shared definitions stay cycle-free", async () => {
  const [action, shared, dialog, page, email] = await Promise.all([read("src/app/(app)/invoices/void-actions.ts"), read("src/lib/invoice-void.ts"), read("src/components/void-invoice-button.tsx"), read("src/app/(app)/invoices/[id]/page.tsx"), read("src/app/(app)/invoices/email-actions.tsx")]);
  const runtimeExports = [...action.matchAll(/^export\s+(?:const|let|var|function|class|async function)\s+(\w+)/gm)].map((match) => match[0]);
  assert.deepEqual(runtimeExports, ["export async function voidInvoice"]);
  assert.match(shared, /INVOICE_VOID_REASON_OPTIONS/); assert.match(dialog, /from "@\/lib\/invoice-void"/); assert.match(page, /VoidInvoiceButton/);
  assert.doesNotMatch(email, /void-actions/); assert.doesNotMatch(shared, /void-actions|email-actions/); assert.doesNotMatch(action, /email-actions/);
});

test("payments and editing remain open-only so void cannot be paid or auto-closed", async () => {
  const [payments, lifecycle] = await Promise.all([read("src/app/(app)/invoices/payment-actions.ts"), read("src/app/(app)/invoices/lifecycle-actions.ts")]);
  assert.match(payments, /status: "open"/); assert.match(payments, /FOR UPDATE/); assert.match(lifecycle, /status: "open", legacySourceTable: null/);
});

test("void is excluded from sales, tax, dashboard progress, closed sales, and active AR", async () => {
  const [sales, dashboard, ar] = await Promise.all([read("src/lib/reportable-sales.ts"), read("src/lib/data/dashboard.ts"), read("src/lib/data/accounts-receivable.ts")]);
  assert.match(sales, /status: "closed"/); assert.match(dashboard, /status: \{ not: "void" \}/); assert.match(dashboard, /status: OPEN_INVOICE_STATUS/); assert.match(dashboard, /status: CLOSED_INVOICE_STATUS/);
  assert.match(ar, /status: filter/);
});

test("general list and customer, vehicle, and RO histories retain and label void invoices", async () => {
  const [list, service, history] = await Promise.all([read("src/app/(app)/invoices/page.tsx"), read("src/components/service-history.tsx"), read("src/lib/data/repair-order-history.ts")]);
  assert.match(list, /invoice\.status === "void"/); assert.match(list, /VOID · \$0\.00/); assert.match(service, /entry\.status === "void"/);
  assert.match(history, /invoice\.status === "void" \? "void"/);
});

test("detail, print, PDF, and emailed PDF clearly render VOID with zero balance", async () => {
  const [detail, model, html, pdf, email] = await Promise.all([read("src/app/(app)/invoices/[id]/page.tsx"), read("src/lib/invoice-document.ts"), read("src/components/invoice-document-html.tsx"), read("src/components/pdf/invoice-document-pdf.tsx"), read("src/components/email-invoice-button.tsx")]);
  assert.match(detail, /text-xl font-black tracking-widest">VOID/); assert.match(detail, /voided \? "\$0\.00"/);
  assert.match(model, /invoice\.status === "void" \? new Prisma\.Decimal\(0\)/); assert.match(html, /model\.status === "void"/); assert.match(pdf, /model\.status === "void"/); assert.match(email, /"Void"/);
});

test("void leaves the originating repair order untouched and audit remains configurable", async () => {
  const action = await read("src/app/(app)/invoices/void-actions.ts");
  assert.doesNotMatch(action, /transaction\.repairOrder\.(update|create|delete)/);
  assert.match(action, /invoice_voided/); assert.match(action, /priorStatus/); assert.match(action, /originalTotal/);
  assert.match(action, /category: "operational", enabled: membership\.shop\.auditLoggingEnabled/);
});
