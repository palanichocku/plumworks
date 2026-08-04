import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260804170000_add_complimentary_services/migration.sql");
const ui = read("src/components/repair-order-line-items.tsx");
const actions = read("src/app/(app)/repair-orders/complimentary-service-actions.ts");
const laborActions = read("src/app/(app)/repair-orders/labor-actions.ts");
const totals = read("src/lib/repair-order-totals.ts");
const finalize = read("src/app/(app)/repair-orders/finalize-actions.ts");
const invoiceActions = read("src/app/(app)/invoices/lifecycle-actions.ts");

test("schema explicitly distinguishes complimentary service lines without invalidating existing records", () => {
  assert.match(schema, /model RepairOrderLabor \{[\s\S]*complimentary\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /model InvoiceLabor \{[\s\S]*complimentary\s+Boolean\s+@default\(false\)/);
  assert.equal((migration.match(/ADD COLUMN "complimentary" BOOLEAN NOT NULL DEFAULT false/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|TRUNCATE/i);
});

test("Complimentary Services appears beneath ordinary Labor with description-only controls", () => {
  assert.ok(ui.indexOf("Complimentary Services") > ui.indexOf("<h2 className=\"font-semibold text-slate-950\">Labor</h2>"));
  assert.match(ui, /Record services provided at no charge\./);
  const complimentary = ui.slice(ui.indexOf("function SavedComplimentaryRow"), ui.indexOf("function ServiceCombobox"));
  assert.match(complimentary, /ServiceCombobox/);
  assert.match(complimentary, /PlusIcon/);
  assert.match(complimentary, /Delete complimentary service/);
  assert.doesNotMatch(complimentary, /name="hours"|name="hourlyRate"|LineItemAmountActions/);
});

test("server validation trims descriptions and makes crafted complimentary lines nonbillable", () => {
  assert.match(actions, /\.trim\(\)/);
  assert.match(actions, /description\.length > 500/);
  assert.match(actions, /hours: "0\.00", hourlyRate: "0\.00", complimentary: true/);
  assert.match(actions, /shopId: membership\.shopId/);
  assert.match(actions, /complimentary: true/);
  assert.match(laborActions, /complimentary: false/);
});

test("complimentary lines are excluded from Repair Order and editable Invoice totals", () => {
  assert.match(totals, /where: \{ repairOrderId, shopId, complimentary: false \}/);
  assert.match(finalize, /labor: order\.labor\.filter\(\(line\) => !line\.complimentary\)/);
  assert.match(invoiceActions, /labor: \{ where: \{ complimentary: false \}/);
});

test("finalization preserves the explicit complimentary identity", () => {
  assert.match(finalize, /select: \{ description: true, hours: true, hourlyRate: true, complimentary: true, legacyLineKey: true \}/);
  assert.match(finalize, /complimentary: line\.complimentary/);
});

test("Invoice detail, print/PDF/email models, and unified history separate no-charge services", () => {
  const invoicePage = read("src/app/(app)/invoices/[id]/page.tsx");
  const invoiceDocument = read("src/lib/invoice-document.ts");
  const repairOrderDocument = read("src/lib/repair-order-document.ts");
  const invoiceHtml = read("src/components/invoice-document-html.tsx");
  const invoicePdf = read("src/components/pdf/invoice-document-pdf.tsx");
  const repairOrderPdf = read("src/components/pdf/repair-order-document-pdf.tsx");
  const history = read("src/lib/data/repair-order-history.ts");
  const drawer = read("src/components/repair-order-history-drawer.tsx");
  for (const source of [invoicePage, invoiceDocument, repairOrderDocument, invoiceHtml, invoicePdf, repairOrderPdf, history, drawer]) assert.match(source, /Complimentary|complimentaryServices|complimentary/);
  assert.match(invoiceDocument, /filter\(\(labor\) => !labor\.complimentary\)/);
  assert.match(history, /complimentaryServices:/);
  assert.match(drawer, /"No charge"/);
});

test("Common Service selection copies only its description for complimentary rows", () => {
  const complimentary = ui.slice(ui.indexOf("function SavedComplimentaryRow"), ui.indexOf("function ServiceCombobox"));
  assert.match(complimentary, /onSelect=\{\(service\) => setDescription\(service\.description\)\}/);
  assert.doesNotMatch(complimentary, /defaultHours|defaultLaborRate|setHours|setRate/);
});
