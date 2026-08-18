import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerContactIssues, customerData } from "./lib/customer-vehicle-transform.mjs";
import { legacyCustomerMemo, legacyEmail, legacyPhone, planLegacyCustomerContactBackfill } from "./lib/legacy-customer-contact.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("valid formatted legacy phones normalize without fabrication", () => {
  assert.deepEqual(legacyPhone("248.930.2449"), { value: "(248) 930-2449", issue: null });
  assert.deepEqual(legacyPhone("1 (248) 930-2449"), { value: "(248) 930-2449", issue: null });
  assert.deepEqual(legacyPhone(""), { value: null, issue: null });
  assert.equal(legacyPhone("930-2449").value, null);
  assert.equal(legacyPhone("CALL-ME").issue, "invalid-phone-characters");
});

test("Customer contact projection carries every representable source field", () => {
  const row = { legacyCustno: "SYNTHETIC", rawData: { CUSTOMER: "Example Customer", PHONE: "(248) 555-0101", PHONE2: "586 555 0100", EMAIL: "PERSON@EXAMPLE.COM", ADDRESS: "1 Main St", ADDRESS2: "Suite 2", CITY: "Detroit", STATE: "mi", ZIP: "48201", NOTE: "line one\r\nline two", MESSAGE: "Call first" } };
  assert.deepEqual(customerData(row), { legacyCustno: "SYNTHETIC", displayName: "Example Customer", phone: "(248) 555-0101", phone2: "(586) 555-0100", email: "person@example.com", addressLine1: "1 Main St", addressLine2: "Suite 2", city: "Detroit", state: "MI", postalCode: "48201", notes: "line one\r\nline two", message: "Call first", legacySourceTable: "Cust.DBF" });
  assert.deepEqual(customerContactIssues(row), { phone: null, phone2: null, email: null });
  assert.equal(legacyEmail("not-an-email").issue, "invalid-email");
});

test("memo decoding preserves internal multiline text", () => {
  const pointer = Buffer.alloc(4); pointer.writeUInt32LE(1);
  const text = Buffer.from("First line\r\nSecond line", "latin1");
  const memo = Buffer.alloc(64 + 8 + text.length); memo.writeUInt16BE(64, 6); memo.writeUInt32BE(1, 64); memo.writeUInt32BE(text.length, 68); text.copy(memo, 72);
  assert.equal(legacyCustomerMemo(pointer, memo), "First line\r\nSecond line");
});

test("parallel backfill fills blanks only and protects aliases and current values", () => {
  const sources = [{ legacyCustno: "canonical", displayName: "Example", phone: "(248) 930-2449", email: null }, { legacyCustno: "alias", displayName: "Old Name", phone: "(586) 555-0100", email: null }];
  const customers = [{ id: "one", legacyCustno: "canonical", displayName: "Example", phone: null, email: "current@example.com" }, { id: "two", legacyCustno: "current", displayName: "Current Name", phone: null, email: null }];
  const plan = planLegacyCustomerContactBackfill({ sources, customers, aliases: [{ aliasLegacyCustno: "alias", customerId: "two" }] });
  assert.deepEqual(plan.updates, [{ customerId: "one", legacyCustno: "canonical", values: { phone: "(248) 930-2449" } }]);
  assert.equal(plan.counts.phone.proposedFill, 1);
  assert.equal(plan.counts.phone.aliasProtected, 1);
  assert.equal(plan.counts.displayName.targetConflict, 1);
});

test("final cutover stages Cust.FPT and RO detail renders dynamic Customer contact", async () => {
  const [importer, transform, cutover, roPage] = await Promise.all([read("scripts/import-customers-vehicles.mjs"), read("scripts/lib/customer-vehicle-transform.mjs"), read("scripts/legacy-cutover.mjs"), read("src/app/(app)/repair-orders/[id]/page.tsx")]);
  assert.match(importer, /requiredFiles: \["Cust\.DBF", "Cust\.FPT", "vehicles\.DBF"\]/);
  assert.match(importer, /readDbf\(CUSTOMER_DBF, CUSTOMER_FPT\)/);
  assert.match(transform, /phone: legacyPhone/);
  assert.match(cutover, /runScriptWithOutput\("import-customers-vehicles\.mjs", common\)/);
  assert.match(roPage, /order\.customer\.phone \?\? "Not recorded"/);
  assert.doesNotMatch(roPage, /customerPhoneSnapshot/);
});
