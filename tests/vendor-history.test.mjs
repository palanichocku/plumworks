import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const partActions = read("src/app/(app)/repair-orders/part-actions.ts");
const repairOrderLoader = read("src/lib/data/repair-orders.ts");
const finalization = read("src/app/(app)/repair-orders/finalize-actions.ts");
const historyLoader = read("src/lib/data/repair-order-history.ts");
const historyDrawer = read("src/components/repair-order-history-drawer.tsx");
const serviceHistory = read("src/components/service-history.tsx");
const customerLoader = read("src/lib/data/customers.ts");
const vehicleLoader = read("src/lib/data/vehicles.ts");
const legacyInvoices = read("scripts/transform-invoices.mjs");
const legacyOpenOrders = read("scripts/transform-open-orders.mjs");
const legacySafety = read("scripts/lib/legacy-invoice-transformer-safety.mjs");

test("Repair Order parts preserve a shop-scoped immutable vendor snapshot", () => {
  assert.match(schema, /model RepairOrderPart \{[\s\S]*vendorId\s+String\?[\s\S]*vendorNameSnapshot\s+String\?/);
  assert.match(partActions, /where: \{ id: vendorId, shopId \}/);
  assert.match(partActions, /return \{ vendorId: vendor\.id, vendorNameSnapshot: vendor\.name \}/);
  assert.match(partActions, /MAX_VENDOR_NAME_LENGTH/);
  assert.match(repairOrderLoader, /vendorNameSnapshot: true[\s\S]*vendor: \{ select: \{ id: true, name: true \}/);
});

test("each completed Invoice part receives the exact Repair Order vendor snapshot", () => {
  assert.match(schema, /model InvoicePart \{[\s\S]*vendorNameSnapshot\s+String\?/);
  assert.match(finalization, /parts:[\s\S]*vendorNameSnapshot: true/);
  assert.match(finalization, /vendorNameSnapshot: line\.vendorNameSnapshot/);
});

test("Parts History loaders and UI show recorded Vendor or Not recorded", () => {
  for (const loader of [customerLoader, vehicleLoader]) assert.match(loader, /parts: \{ orderBy: \{ createdAt: "asc" \}, select: \{ id: true, description: true, partNumber: true, vendorNameSnapshot: true \} \}/);
  assert.match(serviceHistory, /Vendor: \{part\.vendorNameSnapshot\?\.trim\(\) \|\| "Not recorded"\}/);
  assert.match(serviceHistory, /Part #: \{part\.partNumber \?\? "Not recorded"\}/);
});

test("unified Invoice and Repair Order history project only line snapshots", () => {
  assert.equal((historyLoader.match(/vendorNameSnapshot: true/g) ?? []).length, 2);
  assert.equal((historyLoader.match(/vendor: part\.vendorNameSnapshot\?\.trim\(\) \|\| null/g) ?? []).length, 2);
  assert.match(historyDrawer, /Vendor: \$\{part\.vendor \?\? "Not recorded"\}/);
  assert.doesNotMatch(historyLoader, /part\.vendor\?\.name|currentVendor|defaultVendor/);
});

test("legacy FINAL and orders SOURCE values map by exact line identity", () => {
  assert.match(legacyInvoices, /vendorNameSnapshot: textValue\(row\.rawData, "SOURCE"\)/);
  assert.match(legacyInvoices, /identity:\(row\)=>row\.legacyLineKey/);
  assert.match(legacyInvoices, /vendor_name_snapshot/);
  assert.match(legacyOpenOrders, /vendorNameSnapshot: textValue\(row\.rawData, "SOURCE"\)/);
  assert.match(legacyOpenOrders, /shopId_legacyLineKey/);
});

test("legacy Invoice vendor recovery is default dry-run and reports zero-write planning counts", () => {
  assert.match(legacySafety, /dryRun: !confirmedWrite/);
  assert.match(legacyInvoices, /Vendor snapshot updates proposed/);
  assert.match(legacyInvoices, /Vendor matches unresolved/);
  assert.match(legacyInvoices, /Vendor matches ambiguous/);
  assert.match(legacyInvoices, /database writes performed/);
});

test("customer-facing Invoice detail, print, PDF, and email document model omit Vendor", () => {
  const invoiceDetail = read("src/app/(app)/invoices/[id]/page.tsx");
  const invoiceLoader = read("src/lib/data/invoices.ts");
  const invoiceDocument = read("src/lib/invoice-document.ts");
  const invoiceHtml = read("src/components/invoice-document-html.tsx");
  const invoicePdf = read("src/components/pdf/invoice-document-pdf.tsx");
  for (const customerOutput of [invoiceDetail, invoiceLoader, invoiceDocument, invoiceHtml, invoicePdf]) assert.doesNotMatch(customerOutput, /vendorNameSnapshot|Vendor:/);
});

test("vendor history changes do not enter financial calculations or unified pagination", () => {
  const totals = read("src/lib/repair-order-totals.ts");
  assert.doesNotMatch(totals, /vendor/i);
  assert.match(historyLoader, /NOT EXISTS[\s\S]*linked_invoice\.repair_order_id = ro\.id/);
  assert.match(historyLoader, /ORDER BY service_date DESC, source_rank DESC, id DESC/);
  assert.match(historyLoader, /LIMIT \$\{REPAIR_ORDER_HISTORY_PAGE_SIZE \+ 1\}/);
});
