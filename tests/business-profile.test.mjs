import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getBusinessProfile } from "../src/lib/business-profile.ts";

const profile = getBusinessProfile();

test("AUTOMOTIVE is the single supported business profile", async () => {
  const types = await readFile(new URL("../src/lib/business-profile.ts", import.meta.url), "utf8");
  assert.equal(profile.businessType, "AUTOMOTIVE");
  assert.match(types, /type BusinessType = "AUTOMOTIVE"/);
  assert.doesNotMatch(types, /LANDSCAPING|HVAC/);
});

test("all current Car Doc modules remain enabled", () => {
  assert.deepEqual(profile.modules, {
    customers: true,
    assets: true,
    workOrders: true,
    invoices: true,
    payments: true,
    accountsReceivable: true,
    reports: true,
    leads: true,
    admin: true,
  });
});

test("automotive terminology preserves current Car Doc wording", () => {
  assert.deepEqual(profile.terminology, {
    businessWorkspace: "Shop Workspace",
    assetSingular: "Vehicle",
    assetPlural: "Vehicles",
    workOrderSingular: "Repair Order",
    workOrderPlural: "Repair Orders",
    workOrderAbbreviation: "RO",
    personnelSingular: "Technician",
    partsLabel: "Parts",
    laborLabel: "Labor",
  });
});

test("current application routes remain unchanged", async () => {
  const navigation = await readFile(new URL("../src/components/app-navigation.tsx", import.meta.url), "utf8");
  for (const route of ["/repair-orders", "/invoices", "/customers", "/vehicles", "/", "/dashboard", "/reports", "/admin", "/help", "/accounts-receivable"]) {
    assert.match(navigation, new RegExp(`href: "${route.replaceAll("/", "\\/")}"`));
  }
});
