import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, input, editPage, editAction, detailPage, customers, globalSearch, repairOrderAction, repairOrderForm, transform] = await Promise.all([
  read("prisma/schema.prisma"), read("src/components/customer-phone-input.tsx"),
  read("src/app/(app)/customers/[id]/edit/page.tsx"), read("src/app/(app)/customers/edit-actions.ts"),
  read("src/app/(app)/customers/[id]/page.tsx"), read("src/lib/data/customers.ts"),
  read("src/lib/data/search.ts"), read("src/app/(app)/repair-orders/actions.ts"),
  read("src/components/new-repair-order-form.tsx"), read("scripts/lib/customer-vehicle-transform.mjs"),
]);

test("the existing nullable phone2 field remains the additional phone storage", () => {
  assert.match(schema, /model Customer[\s\S]*phone\s+String\?[\s\S]*phone2\s+String\?/);
  assert.match(input, /name = "phone"/);
  assert.match(input, /name=\{name\}/);
});

test("new Repair Order customer creation accepts and normalizes an optional second phone", () => {
  assert.match(repairOrderForm, /Primary phone[\s\S]*Additional phone \(optional\)[\s\S]*name="phone2"/);
  assert.match(repairOrderAction, /formData\.get\("phone2"\)/);
  assert.match(repairOrderAction, /storedPhone2 = customerPhoneForStorage\(phone2\)/);
  assert.match(repairOrderAction, /storedPhone2 === undefined/);
  assert.match(repairOrderAction, /phone2: storedPhone2/);
});

test("customer editing loads, validates, stores, and can clear phone2", () => {
  assert.match(customers, /getCustomerForEdit[\s\S]*phone2: true/);
  assert.match(editPage, /Additional phone \(optional\)[\s\S]*name="phone2"[\s\S]*defaultValue=\{customer\.phone2\}/);
  assert.match(editAction, /select: \{ phone: true, phone2: true \}/);
  assert.match(editAction, /storedPhone2 = phone2 === \(existing\.phone2 \?\? ""\) \? existing\.phone2 : customerPhoneForStorage\(phone2\)/);
  assert.match(editAction, /phone2: storedPhone2/);
  assert.match(editPage, /href=\{`\/customers\/\$\{customer\.id\}`\}[\s\S]*>Cancel</);
});

test("customer detail conditionally renders both phones as telephone links", () => {
  assert.match(detailPage, /Primary phone/);
  assert.match(detailPage, /customer\.phone \? <a href=\{`tel:/);
  assert.match(detailPage, /customer\.phone2 \? <>/);
  assert.match(detailPage, /Additional phone/);
  assert.match(detailPage, /`tel:\$\{customer\.phone2\.replaceAll/);
});

test("directory, global, and Repair Order customer searches include phone2 in scoped queries", () => {
  assert.match(customers, /shopId: membership\.shopId[\s\S]*phone2: \{ contains: query \}/);
  assert.match(globalSearch, /shopId,[\s\S]*phone2: \{ contains: token \}/);
});

test("fresh legacy transformation maps authoritative Cust.DBF PHONE2 and reports dynamic coverage", async () => {
  assert.match(transform, /phone2: cleanText\(rawValue\(row\.rawData, "PHONE2"\)\)/);
  const { customerData, reconcileCustomerVehicleRows } = await import("../scripts/lib/customer-vehicle-transform.mjs");
  const source = { legacyCustno: "1", rawData: { CUSTOMER: "Example", PHONE: "586-555-0100", PHONE2: "586-555-0199" } };
  assert.equal(customerData(source).phone2, "586-555-0199");
  const reconciliation = reconcileCustomerVehicleRows([source, { legacyCustno: "2", rawData: { CUSTOMER: "No Second Phone", PHONE2: "  " } }], []);
  assert.deepEqual(reconciliation.secondaryContact, { sourceValues: 1, destinationValues: 1, missingValues: 1, mismatches: 0 });
});
