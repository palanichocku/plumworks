import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [lineItems, page, workspace, styles, loader, partActions, laborActions, vendor, totals] = await Promise.all([
  read("src/components/repair-order-line-items.tsx"),
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/components/repair-order-workspace.tsx"),
  read("src/app/globals.css"),
  read("src/lib/data/repair-orders.ts"),
  read("src/app/(app)/repair-orders/part-actions.ts"),
  read("src/app/(app)/repair-orders/labor-actions.ts"),
  read("src/components/vendor-combobox.tsx"),
  read("src/lib/repair-order-totals.ts"),
]);

test("Parts has exactly one reusable draft row and one Add Part action", () => {
  assert.equal((lineItems.match(/<DraftPartRow/g) ?? []).length, 1);
  assert.doesNotMatch(lineItems, /\+ Add another part|newDraft|Draft\[]/);
  assert.match(lineItems, /action=\{addPartLineWithState\}/);
  assert.match(lineItems, /action=\{updatePartLineWithState\}/);
  assert.match(lineItems, /action=\{deletePartLine\}/);
  assert.match(lineItems, /required maxLength=\{500\}/);
  assert.match(lineItems, /Number\(quantity\) \* Number\(unitPrice\)/);
  assert.equal((lineItems.match(/ariaLabel="Add part"/g) ?? []).length, 1);
  assert.doesNotMatch(lineItems, />Add Part<|>Add Labor</);
  assert.match(lineItems, /label="Clear part" onClear=\{onReset\}/);
  assert.match(lineItems, /key=\{draftVersion\}/);
  assert.match(lineItems, /onReset=\{\(\) => setDraftVersion/);
});

test("Vendor behavior remains integrated in new and saved Part rows", () => {
  assert.equal((lineItems.match(/<VendorCombobox/g) ?? []).length, 2);
  assert.match(lineItems, /defaultVendor=\{line\.vendor\}/);
  assert.match(vendor, /newVendorName/);
  assert.match(partActions, /addPartLineWithState/);
  assert.match(partActions, /updatePartLineWithState/);
});

test("Labor integrates searchable Common Services without immediate persistence", () => {
  assert.doesNotMatch(lineItems, /Add common service/);
  assert.doesNotMatch(lineItems, /\+ Add another labor line/);
  assert.match(lineItems, /role="combobox"/);
  assert.match(lineItems, /aria-label="Common Services"/);
  assert.match(lineItems, /Common Service: \{selectedName\}/);
  assert.match(lineItems, /setDescription\(service\.description\)/);
  assert.match(lineItems, /setHours\(service\.defaultHours\)/);
  assert.match(lineItems, /setRate\(service\.defaultLaborRate\)/);
  assert.doesNotMatch(lineItems, /addCannedServiceLaborLine/);
  assert.match(lineItems, /No matching Common Services[\s\S]*custom labor/);
  assert.match(loader, /description: true, defaultHours: true, defaultLaborRate: true/);
});

test("Labor rows use existing persistence and exact amount inputs", () => {
  assert.equal((lineItems.match(/<DraftLaborRow/g) ?? []).length, 1);
  assert.match(lineItems, /action=\{addLaborLineWithState\}/);
  assert.match(lineItems, /action=\{updateLaborLineWithState\}/);
  assert.match(lineItems, /action=\{deleteLaborLine\}/);
  assert.match(lineItems, /Number\(hours\) \* Number\(rate\)/);
  assert.equal((lineItems.match(/ariaLabel="Add labor"/g) ?? []).length, 1);
  assert.match(lineItems, /label="Clear labor" onClear=\{onReset\}/);
  assert.match(lineItems, /key=\{draftVersion\}/);
  assert.match(laborActions, /await addLaborLine\(formData\)/);
  assert.match(laborActions, /await updateLaborLine\(formData\)/);
});

test("rows are responsive, accessible, independent forms with no horizontal scroller", () => {
  assert.match(lineItems, /ro-part-row/);
  assert.match(lineItems, /ro-labor-row/);
  assert.match(styles, /@container \(min-width: 40rem\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@container \(min-width: 48rem\)[\s\S]*\.ro-part-row[\s\S]*minmax\(0, 1fr\)[\s\S]*\.ro-labor-row/);
  assert.doesNotMatch(lineItems, /overflow-x-(?:auto|scroll)/);
  assert.match(lineItems, /ariaLabel=\{label\}/);
  assert.match(lineItems, /title=\{label\}/);
  assert.match(lineItems, /aria-live="polite"/);
  assert.match(lineItems, /event\.key === "ArrowDown"/);
  assert.match(lineItems, /event\.key === "Escape"/);
  assert.doesNotMatch(lineItems, /<form[\s\S]{0,500}<form/);
});

test("summary is allocated real space and stacks before line controls can overflow", () => {
  assert.match(workspace, /ro-workspace-container min-w-0/);
  assert.match(workspace, /data-ro-main="true"/);
  assert.match(styles, /@container \(min-width: 80rem\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 22rem/);
  assert.match(styles, /\.ro-summary-column[\s\S]*position: sticky/);
  assert.doesNotMatch(workspace + styles, /position:\s*(?:absolute|fixed)/);
  assert.doesNotMatch(workspace + lineItems + styles, /overflow-x-(?:auto|scroll)/);
});

test("amount and icon actions stay in one compact accessible cluster", () => {
  assert.match(lineItems, /function ActionCluster/);
  assert.match(lineItems, /flex min-w-48 items-end justify-between/);
  for (const label of ["Add part", "Clear part", "Save part", "Delete part", "Add labor", "Clear labor", "Save labor", "Delete labor"]) assert.match(lineItems, new RegExp(`(?:ariaLabel|label)="${label}"`));
  assert.match(lineItems, /pendingAriaLabel="Adding part"/);
  assert.match(lineItems, /pendingAriaLabel="Saving labor"/);
  assert.match(lineItems, /<PlusIcon \/>/);
  assert.match(lineItems, /<CheckIcon \/>/);
  assert.doesNotMatch(lineItems, />\s*(?:Add Part|Add Labor|Save|Update|Delete)\s*</);
  const clearButton = lineItems.slice(lineItems.indexOf("function ClearDraftButton"), lineItems.indexOf("function Amount"));
  assert.match(clearButton, /type="button"/);
  assert.doesNotMatch(clearButton, /formAction|deletePartLine|deleteLaborLine/);
});

test("surrounding workflow and server-authoritative calculations are unchanged", () => {
  assert.match(page, /Repair Order Summary/);
  assert.match(page, /EditableRepairOrderWorkspace/);
  assert.match(page, /EditableRepairOrderWorkspace/);
  assert.match(totals, /refreshRepairOrderTotals/);
  assert.doesNotMatch(lineItems, /shopSupplies|taxTotal|estimatedTotal|calculateShopSupplies/);
});
