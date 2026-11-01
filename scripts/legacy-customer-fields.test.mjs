import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerData } from "./lib/customer-vehicle-transform.mjs";
import { legacyCustomerMemo } from "./lib/legacy-customer-contact.mjs";
import { reconcileLegacyCustomerFields } from "./lib/legacy-customer-field-reconciliation.mjs";
import { customerCreateData } from "./lib/legacy-customer-recovery.mjs";

test("CUSTOM1 maps to optional first name without changing display name", () => {
  const row = customerData({ legacyCustno: "SYNTHETIC-1", rawData: { CUSTOMER: "SYNTHETIC SHOP", CUSTOM1: "  Alex  ", NOTE: "Line one\r\nLine two" } });
  assert.equal(row.displayName, "SYNTHETIC SHOP");
  assert.equal(row.firstName, "Alex");
  assert.equal(row.notes, "Line one\r\nLine two");
  assert.equal(customerData({ legacyCustno: "SYNTHETIC-2", rawData: { CUSTOMER: "SYNTHETIC TWO" } }).firstName, null);
});

test("FoxPro memo decodes multiline Windows text and ignores invalid pointers", () => {
  const memo = Buffer.alloc(128);
  memo.writeUInt16BE(64, 6);
  memo.writeUInt32BE(1, 64);
  const content = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x32]);
  memo.writeUInt32BE(content.length, 68);
  content.copy(memo, 72);
  const pointer = Buffer.alloc(4);
  pointer.writeUInt32LE(1);
  assert.equal(legacyCustomerMemo(pointer, memo), "Café\r\n2");
  pointer.writeUInt32LE(999);
  assert.equal(legacyCustomerMemo(pointer, memo), null);
  pointer.writeUInt32LE(0);
  assert.equal(legacyCustomerMemo(pointer, memo), null);
});

test("first-name and note mismatches block customer acceptance", () => {
  const source = [{ legacyCustno: "SYNTHETIC-1", firstName: "Alex", notes: "A\nB" }];
  const exact = reconcileLegacyCustomerFields(source, structuredClone(source));
  assert.equal(exact.blockingIssues, 0);
  assert.equal(exact.sourceCustomersWithNotes, 1);
  const changed = reconcileLegacyCustomerFields(source, [{ legacyCustno: "SYNTHETIC-1", firstName: null, notes: "A B" }]);
  assert.equal(changed.firstNameMismatches, 1);
  assert.equal(changed.noteMismatches, 1);
  assert.equal(changed.blockingIssues, 2);
  assert.equal(reconcileLegacyCustomerFields(source, []).unresolved, 1);
});

test("recovered Customers leave unknown first names null", () => {
  const recovered = customerCreateData({ legacyCustomerId: "SYNTHETIC-3", displayName: "SYNTHETIC HISTORY" }, "11111111-1111-4111-8111-111111111111");
  assert.equal(recovered.firstName, null);
});

test("Customer create, edit, and detail all carry the optional first name", async () => {
  const [schema, create, edit, form, detail, loader] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("src/app/(app)/customer-vehicle-create-actions.ts", "utf8"),
    readFile("src/app/(app)/customers/edit-actions.ts", "utf8"),
    readFile("src/components/customer-edit-form.tsx", "utf8"),
    readFile("src/app/(app)/customers/[id]/page.tsx", "utf8"),
    readFile("src/lib/data/customers.ts", "utf8"),
  ]);
  assert.match(schema, /firstName\s+String\?\s+@map\("first_name"\)/);
  assert.match(create, /firstName: firstName \|\| null/);
  assert.match(edit, /firstName: firstName \|\| null/);
  assert.match(form, /name="firstName"[^>]*defaultValue=\{customer\.firstName/);
  assert.match(detail, /customer\.firstName \?\? "Not recorded"/);
  assert.match(loader, /getCustomerForEdit[\s\S]*firstName: true/);
});

test("final cutover requires and reads Cust.FPT in both intake and import", async () => {
  const [intake, cutover, importer] = await Promise.all([
    readFile("scripts/legacy-snapshot-intake.mjs", "utf8"),
    readFile("scripts/legacy-cutover.mjs", "utf8"),
    readFile("scripts/import-customers-vehicles.mjs", "utf8"),
  ]);
  assert.match(intake, /"Cust\.DBF",\s*"Cust\.FPT"/);
  assert.match(cutover, /readDbfForReconciliation\(sourceDirectory\.files\["Cust\.DBF"\], sourceDirectory\.files\["Cust\.FPT"\]\)/);
  assert.match(importer, /readDbf\(CUSTOMER_DBF, CUSTOMER_FPT\)/);
});
