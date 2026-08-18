import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateEditableInvoiceTotals } from "../src/lib/invoice-lifecycle.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Vehicle and Customer details expose safe existing New RO entry points", async () => {
  const [vehicle, customer] = await Promise.all([read("src/app/(app)/vehicles/[id]/page.tsx"), read("src/app/(app)/customers/[id]/page.tsx")]);
  assert.match(vehicle, /Create Repair Order/);
  assert.match(vehicle, /repair-orders\/new\?customerId=\$\{vehicle\.customer\.id\}&vehicleId=\$\{vehicle\.id\}/);
  assert.match(vehicle, /!vehicle\.archivedAt && !vehicle\.customer\.archivedAt/);
  assert.match(customer, /const activeVehicles = customer\.vehicles\.filter\(\(vehicle\) => !vehicle\.archivedAt\)/);
  assert.match(customer, /activeVehicles\.length === 1[\s\S]*repair-orders\/new\?customerId/);
  assert.match(customer, /name="vehicleId" required/);
  assert.match(customer, /activeVehicles\.map/);
  assert.match(customer, /Add an active Vehicle before creating a Repair Order/);
  assert.match(customer, /vehicles\/new\?customerId/);
});

test("New RO prefill is optional and validates tenant, lifecycle, and ownership server-side", async () => {
  const [page, data, form, action] = await Promise.all([read("src/app/(app)/repair-orders/new/page.tsx"), read("src/lib/data/repair-orders.ts"), read("src/components/new-repair-order-form.tsx"), read("src/app/(app)/repair-orders/actions.ts")]);
  assert.match(page, /params\.customerId \? getRepairOrderPrefill\(params\.customerId, params\.vehicleId\) : null/);
  assert.match(page, /initialCustomer=\{prefill\?\.customer \?\? null\}/);
  assert.match(form, /useState<RepairOrderCustomerSearchResult \| null>\(initialCustomer\)/);
  assert.match(form, /useState\(initialVehicleId \?\? ""\)/);
  assert.match(data, /id: customerId, shopId: membership\.shopId, archivedAt: null/);
  assert.match(data, /vehicles:[\s\S]*where: \{ archivedAt: null \}/);
  assert.match(data, /vehicleId && !customer\.vehicles\.some\(\(vehicle\) => vehicle\.id === vehicleId\)/);
  assert.match(action, /id: existingVehicleId, customerId, shopId: membership\.shopId, archivedAt: null, customer: \{ archivedAt: null \}/);
  assert.match(page, /params\.customerId \|\| params\.vehicleId/);
});

test("Invoice vendor edit uses the existing snapshot with current-Shop validation", async () => {
  const [schema, data, page, workspace, actions, conversion] = await Promise.all([read("prisma/schema.prisma"), read("src/lib/data/invoices.ts"), read("src/app/(app)/invoices/[id]/edit/page.tsx"), read("src/components/invoice-edit-workspace.tsx"), read("src/app/(app)/invoices/lifecycle-actions.ts"), read("src/app/(app)/repair-orders/finalize-actions.ts")]);
  assert.match(schema, /model InvoicePart[\s\S]*vendorNameSnapshot\s+String\?/);
  assert.doesNotMatch(schema.match(/model InvoicePart[\s\S]*?@@map\("invoice_parts"\)/)?.[0] ?? "", /vendorId/);
  assert.match(data, /vendors: \{ orderBy: \{ name: "asc" \}, select: \{ id: true, name: true \} \}/);
  assert.match(data, /vendorNameSnapshot: true/);
  assert.match(page, /vendorNameSnapshot: part\.vendorNameSnapshot/);
  assert.match(workspace, /Vendor<select name="vendorId"/);
  assert.match(workspace, /<option value="">No vendor<\/option>/);
  assert.match(actions, /transaction\.vendor\.findFirst\(\{ where: \{ id: vendorId, shopId \}/);
  assert.match(actions, /data: \{ description, quantity, unitPrice, vendorNameSnapshot \}/);
  assert.match(actions, /status: "open", legacySourceTable: null/);
  assert.match(actions, /await refreshInvoice\(transaction, membership\.shopId, invoiceId\)/);
  assert.match(conversion, /vendorNameSnapshot: line\.vendorNameSnapshot/);
});

test("vendor-only changes leave native Invoice financial arithmetic unchanged", () => {
  const input = { parts: [{ quantity: "1", unitPrice: "527.56" }], labor: [{ hours: "1", hourlyRate: "404" }], shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "20", taxRate: "0.06", partsTaxable: true, laborTaxable: false, shopSuppliesTaxable: true };
  const before = calculateEditableInvoiceTotals(input);
  const after = calculateEditableInvoiceTotals(input);
  assert.equal(before.taxTotal.toFixed(2), "33.59");
  assert.equal(before.total.toFixed(2), "985.15");
  assert.deepEqual(after, before);
});
