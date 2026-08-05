import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [history, drawer, sharedDrawer, actions, loader, customers, vehicles, customerPage, vehiclePage] = await Promise.all([
  read("src/components/service-history.tsx"),
  read("src/components/service-history-detail-drawer.tsx"),
  read("src/components/repair-order-history-drawer.tsx"),
  read("src/app/(app)/service-history-actions.ts"),
  read("src/lib/data/repair-order-history.ts"),
  read("src/lib/data/customers.ts"),
  read("src/lib/data/vehicles.ts"),
  read("src/app/(app)/customers/[id]/page.tsx"),
  read("src/app/(app)/vehicles/[id]/page.tsx"),
]);

test("RO number opens an in-page internal detail instead of navigating", () => {
  assert.match(history, /<button type="button"[\s\S]*setSelected\(\{ source: entry\.source, id: entry\.id \}\)/);
  assert.doesNotMatch(history, /href=\{`\/invoices\/\$\{entry\.id\}`\}/);
  assert.match(history, /<ServiceHistoryDetailDrawer/);
  assert.doesNotMatch(drawer, /router\.|window\.location|pushState|replaceState/);
});

test("shared internal detail includes historical Vendor, mileage, work, and no-charge services", () => {
  assert.match(sharedDrawer, /Vendor: \$\{part\.vendor \?\? "Not recorded"\}/);
  assert.match(sharedDrawer, /Mileage at service/);
  assert.match(sharedDrawer, /Customer Complaint/);
  assert.match(sharedDrawer, /Recommendations/);
  assert.match(sharedDrawer, /Complimentary Services/);
  assert.match(sharedDrawer, /No charge/);
  assert.match(sharedDrawer, /Stored Service Totals/);
});

test("record actions are secondary and route to the correct internal record", () => {
  assert.match(sharedDrawer, /detail\.source === "invoice" \? `\/invoices\/\$\{detail\.id\}`/);
  assert.match(sharedDrawer, /detail\.legacyReadOnly \? `\/open-orders\/\$\{detail\.id\}` : `\/repair-orders\/\$\{detail\.id\}`/);
  assert.match(sharedDrawer, /"View Invoice" : "View Repair Order"/);
  assert.match(loader, /lifecycleLabel: invoice\.legacySourceTable \? "Legacy service" : "Completed service"/);
  assert.match(loader, /lifecycleLabel: order\.legacySourceTable \? "Legacy · read only"/);
});

test("customer and vehicle histories share the same detail behavior and bounded unified list", () => {
  assert.match(customerPage, /context="customer" contextId=\{customer\.id\}/);
  assert.match(vehiclePage, /context="vehicle" contextId=\{vehicle\.id\}/);
  for (const source of [customers, vehicles]) {
    assert.match(source, /repairOrders: \{[\s\S]*where: \{ invoices: \{ none: \{\} \} \}/);
    assert.match(source, /take: 50/);
  }
  assert.match(history, /sourceRank\[right\.source\] - sourceRank\[left\.source\]/);
  assert.match(history, /\.slice\(0, 50\)/);
});

test("detail is loaded only after selection and is tenant/context scoped", () => {
  assert.doesNotMatch(customers + vehicles, /getServiceHistoryDetail/);
  assert.match(drawer, /loadServiceHistoryDetail\(context, contextId, source, recordId\)/);
  assert.match(actions, /getServiceHistoryDetail\(context, contextId, source, historicalId\)/);
  assert.match(loader, /getCurrentMembership\(\)/);
  assert.match(loader, /customer\.findFirst\(\{ where: \{ id: contextId, shopId: membership\.shopId \}/);
  assert.match(loader, /vehicle\.findFirst\(\{ where: \{ id: contextId, shopId: membership\.shopId \}/);
  assert.match(loader, /id: historicalId, shopId: scope\.shopId, customerId: scope\.customerId, vehicleId: scope\.vehicleId/);
});

test("drawer preserves page context and meets keyboard dialog behavior", () => {
  assert.match(drawer, /createPortal/);
  assert.match(drawer, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /event\.key !== "Tab"/);
  assert.match(history, /requestAnimationFrame\(\(\) => triggerRef\.current\?\.focus\(\)\)/);
  assert.match(drawer, />Close<\/button>/);
});
