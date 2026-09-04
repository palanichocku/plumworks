import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("RO document projection uses only current RepairOrder.odometer", async () => {
  const model = await read("src/lib/repair-order-document.ts");
  assert.match(model, /closedAt: true,\s*odometer: true/);
  assert.match(model, /odometer: order\.odometer/);
  const vehicleSelect = model.slice(model.indexOf("vehicle: { select:"), model.indexOf("parts: { orderBy:"));
  assert.doesNotMatch(vehicleSelect, /odometer/);
  assert.doesNotMatch(model, /order\.vehicle\.odometer|vehicle\.odometer/);
});

test("RO browser print and emailed PDF show current mileage and an explicit blank marker", async () => {
  const [html, pdf, email] = await Promise.all([
    read("src/components/repair-order-document-html.tsx"),
    read("src/components/pdf/repair-order-document-pdf.tsx"),
    read("src/app/(app)/repair-orders/email-actions.tsx"),
  ]);
  for (const renderer of [html, pdf]) {
    assert.match(renderer, /model\.odometer\?\.toLocaleString\(\) \?\? "—"/);
    assert.doesNotMatch(renderer, /model\.vehicle\.odometer/);
  }
  assert.match(email, /getRepairOrderDocumentForShop/);
});

test("vehicle change clears current mileage and customer-only change preserves it", async () => {
  const reassignment = await read("src/app/(app)/repair-orders/reassignment-actions.ts");
  assert.match(reassignment, /vehicleChanged \? \{ odometer: null \} : \{\}/);
  assert.doesNotMatch(reassignment, /customerChanged \? \{ odometer: null \}/);
});

test("Invoice creation and documents use the persisted Invoice mileage snapshot", async () => {
  const [conversion, model, html, pdf] = await Promise.all([
    read("src/app/(app)/repair-orders/finalize-actions.ts"),
    read("src/lib/invoice-document.ts"),
    read("src/components/invoice-document-html.tsx"),
    read("src/components/pdf/invoice-document-pdf.tsx"),
  ]);
  assert.match(conversion, /invoiceDate: now,\s*odometer: order\.odometer/);
  assert.match(model, /odometer: invoice\.odometer/);
  assert.doesNotMatch(model, /invoice\.odometer \?\? invoice\.repairOrder\?\.odometer|vehicle\?\.odometer/);
  assert.match(html, /model\.vehicle\.odometer\?\.toLocaleString\(\)/);
  assert.match(pdf, /model\.vehicle\.odometer\?\.toLocaleString\(\)/);
});

test("interactive RO retains separate historical-reference and current-mileage UI", async () => {
  const page = await read("src/app/(app)/repair-orders/[id]/page.tsx");
  assert.match(page, /Last recorded mileage/);
  assert.match(page, /RepairOrderMileageField/);
  assert.match(page, /mileage=\{order\.odometer\}/);
});

test("legacy open-order print no longer substitutes Vehicle.odometer", async () => {
  const print = await read("src/app/(app)/open-orders/[id]/print/page.tsx");
  assert.match(print, /const mileage = order\.odometer/);
  assert.doesNotMatch(print, /order\.odometer \?\? order\.vehicle\.odometer/);
});
