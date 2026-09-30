import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [lineItems, historyCombobox, layout, page, workspace, styles, loader, partActions, laborActions, vendor, totals] = await Promise.all([
  read("src/components/repair-order-line-items.tsx"),
  read("src/components/historical-description-combobox.tsx"),
  read("src/components/line-item-layout.tsx"),
  read("src/app/(app)/repair-orders/[id]/page.tsx"),
  read("src/components/repair-order-workspace.tsx"),
  read("src/app/globals.css"),
  read("src/lib/data/repair-orders.ts"),
  read("src/app/(app)/repair-orders/part-actions.ts"),
  read("src/app/(app)/repair-orders/labor-actions.ts"),
  read("src/components/vendor-combobox.tsx"),
  read("src/lib/repair-order-totals.ts"),
]);
const editableWorkspace = await read("src/components/repair-order-concerns-form.tsx");
const appShell = await read("src/components/app-shell.tsx");

test("Parts has exactly one reusable draft row and one Add Part action", () => {
  assert.equal((lineItems.match(/<DraftPartRow/g) ?? []).length, 1);
  assert.doesNotMatch(lineItems, /\+ Add another part|newDraft|Draft\[]/);
  assert.match(lineItems, /action=\{addPartLineWithState\}/);
  assert.match(lineItems, /action=\{updatePartLineWithState\}/);
  assert.match(lineItems, /action=\{deletePartLine\}/);
  assert.match(historyCombobox, /required: true, maxLength: 500/);
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

test("Labor retains Common Services alongside historical free-text search without immediate persistence", () => {
  assert.doesNotMatch(lineItems, /Add common service/);
  assert.doesNotMatch(lineItems, /\+ Add another labor line/);
  assert.match(historyCombobox, /role: "combobox"/);
  assert.match(lineItems, /aria-label="Common Services"/);
  assert.match(lineItems, /setDescription\(service\.description\)/);
  assert.match(lineItems, /setHours\(service\.defaultHours\)/);
  assert.match(lineItems, /setRate\(service\.defaultLaborRate\)/);
  assert.doesNotMatch(lineItems, /addCannedServiceLaborLine/);
  assert.match(historyCombobox, /Continue typing to use a new description/);
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
  assert.match(lineItems, /ro-part-controls grid min-w-0 items-end gap-3/);
  assert.match(lineItems, /ro-labor-controls grid min-w-0 items-end gap-3/);
  assert.match(layout, /baseLineItemRowClass = "grid min-w-0 items-end gap-3"/);
  assert.match(layout, /partLineItemRowClass = `\$\{baseLineItemRowClass\} ro-part-row`/);
  assert.match(layout, /laborLineItemRowClass = `\$\{baseLineItemRowClass\} ro-labor-row`/);
  assert.doesNotMatch(lineItems, /overflow-x-(?:auto|scroll)/);
  assert.match(lineItems, /ariaLabel=\{label\}/);
  assert.match(lineItems, /title=\{label\}/);
  assert.match(lineItems, /aria-live="polite"/);
  assert.match(historyCombobox, /event\.key === "ArrowDown"/);
  assert.match(historyCombobox, /event\.key === "Escape"/);
  assert.doesNotMatch(lineItems, /<form[\s\S]{0,500}<form/);
});

test("summary is allocated real space and stacks before line controls can overflow", () => {
  assert.match(workspace, /ro-workspace-container ro-screen min-w-0/);
  assert.match(workspace, /data-ro-main="true"/);
  assert.match(styles, /@container \(min-width: 80rem\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 22rem/);
  assert.match(styles, /\.ro-summary-column[\s\S]*position: sticky/);
  assert.doesNotMatch(workspace + styles, /position:\s*(?:absolute|fixed)/);
  assert.doesNotMatch(workspace + lineItems + styles, /overflow-x-(?:auto|scroll)/);
});

test("editable Parts and Labor use a side-by-side desktop workbench with Labor kept near the top", () => {
  assert.match(appShell, /lg:hidden/);
  assert.match(appShell, /lg:flex/);
  assert.match(editableWorkspace, /lineItemsWorkbench/);
  assert.match(workspace, /data-ro-line-workbench="true"/);
  assert.match(workspace, /data-ro-section="parts"/);
  assert.match(workspace, /data-ro-section="labor"/);
  assert.match(styles, /\.ro-line-workbench[\s\S]*display: grid/);
  assert.match(styles, /@media \(min-width: 64rem\)[\s\S]*\.ro-line-workbench\s*\{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.ro-line-workbench\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.doesNotMatch(styles, /ro-line-workbench-container|container: ro-line-workbench|@container ro-line-workbench/);
  const desktopRule = styles.slice(styles.indexOf("@media (min-width: 64rem)"), styles.indexOf("@container (min-width: 40rem)"));
  assert.match(desktopRule, /\.ro-line-workbench > \[data-ro-section="labor"\]\s*\{\s*position: sticky/);
  assert.doesNotMatch(styles, /\.ro-line-workbench[^}]*overflow-y:\s*(?:auto|scroll)/);
});

test("draft Add Part and Add Labor rows stay before saved rows in their panels", () => {
  const partsCard = lineItems.slice(lineItems.indexOf("export function RepairOrderPartsCard"), lineItems.indexOf("function SavedPartRow"));
  const laborCard = lineItems.slice(lineItems.indexOf("export function RepairOrderLaborCard"), lineItems.indexOf("function LaborActionForm"));
  assert.ok(partsCard.indexOf("<DraftPartRow") < partsCard.indexOf("<SavedPartRow"));
  assert.ok(laborCard.indexOf("<DraftLaborRow") < laborCard.indexOf("<SavedLaborRow"));
  assert.equal((partsCard.match(/<DraftPartRow/g) ?? []).length, 1);
  assert.equal((laborCard.match(/<DraftLaborRow/g) ?? []).length, 1);
});

test("amount and icon actions stay in one compact accessible cluster", () => {
  assert.match(lineItems, /LineItemAmountActions/);
  assert.match(layout, /flex min-w-48 items-end justify-between/);
  for (const label of ["Add part", "Clear part", "Save part", "Delete part", "Add labor", "Clear labor", "Save labor", "Delete labor"]) assert.match(lineItems, new RegExp(`(?:ariaLabel|label)="${label}"`));
  assert.match(lineItems, /pendingAriaLabel="Adding part"/);
  assert.match(lineItems, /pendingAriaLabel="Saving labor"/);
  assert.match(lineItems, /<PlusIcon \/>/);
  assert.match(lineItems, /<CheckIcon \/>/);
  assert.doesNotMatch(lineItems, />\s*(?:Add Part|Add Labor|Save|Update|Delete)\s*</);
  const clearButton = layout.slice(layout.indexOf("function ClearLineItemButton"));
  assert.match(clearButton, /type="button"/);
  assert.doesNotMatch(clearButton, /formAction|deletePartLine|deleteLaborLine/);
});

test("surrounding workflow and server-authoritative calculations are unchanged", () => {
  assert.match(page, /Repair Order Summary/);
  assert.match(page, /EditableRepairOrderWorkspace/);
  assert.match(page, /EditableRepairOrderWorkspace/);
  assert.match(totals, /refreshRepairOrderTotals/);
  assert.doesNotMatch(lineItems, /taxTotal|estimatedTotal|calculateShopSupplies/);
});
