import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeRepairOrderCustomerQuery,
  REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT,
} from "../src/lib/repair-order-customer-search.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [action, combobox, form, loader, creation] = await Promise.all([
  read("src/app/(app)/repair-orders/customer-search-actions.ts"),
  read("src/components/repair-order-customer-combobox.tsx"),
  read("src/components/new-repair-order-form.tsx"),
  read("src/lib/data/repair-orders.ts"),
  read("src/app/(app)/repair-orders/actions.ts"),
]);

test("blank search is normalized away and one character remains searchable", () => {
  assert.equal(normalizeRepairOrderCustomerQuery("   "), "");
  assert.equal(normalizeRepairOrderCustomerQuery("  V  "), "V");
  assert.equal(normalizeRepairOrderCustomerQuery("x".repeat(150)).length, 100);
  assert.match(action, /if \(!query\) return \[\]/);
});

test("search is authenticated, shop scoped, and limited to ten database results", () => {
  assert.equal(REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT, 10);
  assert.match(action, /getCurrentMembership\(\)/);
  assert.match(action, /if \(!membership\) return \[\]/);
  assert.match(action, /shopId: membership\.shopId/);
  assert.match(action, /take: REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT/);
  assert.doesNotMatch(action, /addressLine|postalCode|city:/);
});

test("name, phone, and email use established matching conventions", () => {
  assert.match(action, /displayName: \{ contains: query, mode: "insensitive" \}/);
  assert.match(action, /phone: \{ contains: query \}/);
  assert.match(action, /email: \{ contains: query, mode: "insensitive" \}/);
  assert.doesNotMatch(action, /legacyCustno/);
});

test("customer search is debounced, cached, and stale responses are ignored", () => {
  assert.match(combobox, /SEARCH_DEBOUNCE_MS = 300/);
  assert.match(combobox, /window\.setTimeout/);
  assert.match(combobox, /cache\.current\.get\(normalizedKey\)/);
  assert.match(combobox, /sequence !== requestSequence\.current/);
  assert.match(combobox, /requestSequence\.current \+= 1/);
  assert.doesNotMatch(combobox.slice(combobox.indexOf("catch {"), combobox.indexOf("finally {")), /onSelect/);
});

test("selection submits the authoritative ID and preserves vehicle reset behavior", () => {
  assert.match(combobox, /name="customerId" value=\{selected\?\.id \?\? ""\}/);
  assert.match(form, /setSelectedCustomer\(nextCustomer\)/);
  assert.match(form, /setVehicleId\(nextCustomer\?\.vehicles\[0\]\?\.id \?\? ""\)/);
  assert.match(form, /setVehicleMode\(nextCustomer\?\.vehicles\.length \? "existing" : "new"\)/);
  assert.match(combobox, /onSelect\(null\)/);
  assert.match(form, /const vehicles = selectedCustomer\?\.vehicles \?\? \[\]/);
  assert.match(creation, /where: \{ id: existingCustomerId, shopId: membership\.shopId \}/);
  assert.match(creation, /where: \{ id: existingVehicleId, customerId, shopId: membership\.shopId \}/);
});

test("combobox supports keyboard and accessible listbox interaction", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.match(combobox, new RegExp(`event\\.key === "${key}"`));
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /aria-autocomplete="list"/);
  assert.match(combobox, /aria-expanded=\{showPanel\}/);
  assert.match(combobox, /role="listbox"/);
  assert.match(combobox, /role="option"/);
  assert.match(combobox, /type="button"/);
});

test("concise loading, empty, and initial states are present", () => {
  assert.match(combobox, /Loading customers…/);
  assert.match(combobox, /No matching customers found\./);
  assert.match(combobox, /Start typing to find an existing customer\./);
});

test("the full customer collection is no longer loaded or sent to the form", () => {
  const optionsLoader = loader.slice(loader.indexOf("export async function getRepairOrderFormOptions"), loader.indexOf("export async function getWebRepairOrderForCurrentShop"));
  assert.doesNotMatch(optionsLoader, /customers[,)]|customers:/);
  assert.doesNotMatch(form, /customers\.map|<select id="customerId"/);
  assert.match(form, /<RepairOrderCustomerCombobox/);
});

test("new-customer fields, vehicle selector, mileage, and layout remain present", () => {
  for (const marker of ["Existing Customer", "New Customer", "displayName", "CustomerPhoneInput", "Select Active Vehicle", 'select id="vehicleId"', "Mileage at service", 'data-repair-order-layout="split"']) {
    assert.match(form, new RegExp(marker));
  }
});
