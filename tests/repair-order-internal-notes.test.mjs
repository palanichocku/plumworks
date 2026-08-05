import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [panel, editor, newForm, combobox, searchAction, actions, orderLoader, orderPage, customerPage, vehiclePage, history] = await Promise.all([
  read("src/components/repair-order-internal-notes-panel.tsx"), read("src/components/internal-note-editor.tsx"),
  read("src/components/new-repair-order-form.tsx"), read("src/components/repair-order-customer-combobox.tsx"), read("src/app/(app)/repair-orders/customer-search-actions.ts"),
  read("src/app/(app)/internal-notes-actions.ts"), read("src/lib/data/repair-orders.ts"),
  read("src/app/(app)/repair-orders/[id]/page.tsx"), read("src/app/(app)/customers/[id]/page.tsx"),
  read("src/app/(app)/vehicles/[id]/page.tsx"), read("src/lib/data/repair-order-history.ts"),
]);

test("new Repair Order selection carries distinct Customer and Vehicle internal context", () => {
  assert.match(searchAction, /displayName: string;[\s\S]*notes: string \| null;[\s\S]*vehicles: Array<[\s\S]*notes: string \| null/);
  assert.match(searchAction, /shopId: membership\.shopId/);
  assert.match(searchAction, /notes: true,[\s\S]*vehicles:[\s\S]*notes: true/);
  assert.match(newForm, /selectedVehicle = vehicleMode === "existing"/);
  assert.match(newForm, /<RepairOrderInternalNotesPanel[\s\S]*customer=\{selectedCustomer\}[\s\S]*vehicle=\{selectedVehicle\}/);
  assert.ok(newForm.indexOf("<RepairOrderInternalNotesPanel") < newForm.indexOf("new-repair-order-concerns-title"));
});

test("panel is compact, internal-only, mobile-safe, and keeps entity notes separate", () => {
  assert.match(panel, /Internal notes/);
  assert.match(panel, /Not shown to customer/);
  assert.match(panel, /No internal customer note/);
  assert.match(panel, /No internal vehicle note/);
  assert.match(panel, /label="Customer"/);
  assert.match(panel, /label="Vehicle"/);
  assert.match(panel, /min-w-0/);
  assert.match(panel, /sm:grid-cols-2/);
  assert.match(panel, /vehicle \? <div/);
});

test("independent editor preserves the surrounding RO form and supports safe Save and Cancel", () => {
  assert.doesNotMatch(editor, /<form|type="submit"/);
  assert.match(editor, /type="button" onClick=\{save\}/);
  assert.match(editor, /type="button" onClick=\{cancel\}/);
  assert.match(editor, /setDraft\(savedNotes \?\? ""\)/);
  assert.match(editor, /if \(result\.status !== "success"\) return/);
  assert.match(editor, /disabled=\{pending\}/);
  assert.match(editor, /maxLength=\{MAX_INTERNAL_NOTES_LENGTH\}/);
  assert.match(editor, /aria-describedby=\{state\.status === "error"/);
});

test("entity changes reset saved state and stale selection responses remain guarded", () => {
  assert.match(editor, /useState\(notes\)/);
  assert.match(editor, /useState\(notes \?\? ""\)/);
  assert.match(panel, /key=\{`customer-\$\{customer\.id\}`\}/);
  assert.match(panel, /key=\{`vehicle-\$\{vehicle\.id\}`\}/);
  assert.match(combobox, /const sequence = \+\+requestSequence\.current/);
  assert.match(combobox, /if \(sequence !== requestSequence\.current\) return/);
});

test("note updates are permission checked, tenant scoped, and Vehicle context verifies Customer ownership", () => {
  assert.match(actions, /requirePermission\("edit_customer_vehicle"\)/);
  assert.equal((actions.match(/shopId: membership\.shopId/g) ?? []).length, 2);
  assert.match(actions, /contextCustomerId/);
  assert.match(actions, /customerId: contextCustomerId/);
  assert.match(actions, /data: \{ notes: parsed\.notes \}/);
  assert.doesNotMatch(actions, /repairOrder\.update|invoice\.update/);
});

test("existing RO and entity pages use the same editor without copying notes onto the RO", () => {
  assert.match(orderLoader, /getRepairOrderInternalNotesForCurrentShop[\s\S]*shopId: membership\.shopId[\s\S]*customer: \{ select: \{ id: true, notes: true \} \}[\s\S]*vehicle: \{ select: \{ id: true, customerId: true, notes: true \} \}/);
  const documentLoader = orderLoader.slice(orderLoader.indexOf("export async function getWebRepairOrderForCurrentShop"), orderLoader.indexOf("export async function getRepairOrderInternalNotesForCurrentShop"));
  assert.doesNotMatch(documentLoader, /notes: true/);
  assert.equal((orderPage.match(/<RepairOrderInternalNotesPanel/g) ?? []).length, 2);
  assert.match(customerPage, /<InternalNotesBlock/);
  assert.match(vehiclePage, /<InternalNotesBlock/);
  assert.doesNotMatch(orderPage, /data: \{ notes:/);
});

test("persistent entity context is excluded from documents, communications, and service history", async () => {
  const paths = [
    "src/lib/repair-order-document.ts", "src/components/pdf/repair-order-document-pdf.tsx", "src/app/(app)/repair-orders/[id]/print/page.tsx",
    "src/lib/invoice-document.ts", "src/components/pdf/invoice-document-pdf.tsx",
    "src/lib/email/repair-order-email.tsx", "src/lib/email/invoice-email.tsx", "src/lib/marketing-lead-notifications.ts",
  ];
  for (const source of await Promise.all(paths.map(read))) assert.doesNotMatch(source, /customer\.notes|vehicle\.notes|customerNotes|vehicleNotes/);
  assert.doesNotMatch(history, /customer\.notes|vehicle\.notes|customerNotes|vehicleNotes/);
});
