import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/(app)/repair-orders/page.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/lib/data/open-orders.ts", import.meta.url), "utf8");
const lifecycle = await readFile(new URL("../src/lib/repair-order-lifecycle.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/lib/data/dashboard.ts", import.meta.url), "utf8");
const legacyDetail = await readFile(new URL("../src/app/(app)/open-orders/[id]/page.tsx", import.meta.url), "utf8");
const legacyLoader = await readFile(new URL("../src/lib/data/open-orders.ts", import.meta.url), "utf8");
const searchLoader = await readFile(new URL("../src/lib/data/search.ts", import.meta.url), "utf8");
const button = await readFile(new URL("../src/components/void-repair-order-button.tsx", import.meta.url), "utf8");
const action = await readFile(new URL("../src/app/(app)/repair-orders/void-actions.ts", import.meta.url), "utf8");

test("Repair Order list keeps its data headings and has no visible Actions heading", () => {
  for (const heading of ["RO # / Date", "Customer", "Vehicle", "Status / Scope", "Estimated Total"]) {
    assert.match(page, new RegExp(`>${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}<`));
  }
  assert.doesNotMatch(page, />Actions</i);
  assert.match(page, /<th aria-label="Row actions" className="w-14 px-2 py-3">/);
});

test("compact Repair Order action is a clear destructive Void button without a trash icon", () => {
  assert.match(button, /compact\s*\?\s*"inline-flex[\s\S]*?text-red-700/);
  assert.match(button, />\s*Void\s*<\/button>/);
  assert.match(button, /Void RO #\{repairOrderNumber\}\?/);
  assert.match(button, /role="alertdialog"/);
  assert.doesNotMatch(button, /TrashIcon|<svg|Delete repair order/);
});

test("only permitted numbered active rows render the compact Void control", () => {
  assert.match(page, /hasPermission\(membership\.role, "void_repair_order"\)/);
  assert.match(page, /\{canVoid && order\.repairOrderNumber !== null \?/);
  assert.match(page, /<VoidRepairOrderButton repairOrderId=\{order\.id\} repairOrderNumber=\{String\(order\.repairOrderNumber\)\} compact \/>/);
  assert.match(page, /\) : null\}/);
  assert.doesNotMatch(page, />—</);
});

test("active Repair Orders and Dashboard use the same operational query", () => {
  assert.match(lifecycle, /shopId,/);
  assert.match(lifecycle, /status: \{ in: \["draft", "open"\] \}/);
  assert.match(lifecycle, /legacySourceTable: null/);
  assert.match(lifecycle, /invoices: \{ none: \{\} \}/);
  assert.match(loader, /where: operationalRepairOrderWhere\(membership\.shopId\)/);
  assert.match(dashboard, /repairOrder\.count\(\{ where: operationalRepairOrderWhere\(shopId\) \}\)/);
});

test("active list cannot render legacy read-only orders or mislabel editable orders", () => {
  assert.doesNotMatch(page, /legacySourceTable|Read Only|Legacy ·/i);
  assert.match(page, /href=\{`\/repair-orders\/\$\{order\.id\}`\}/);
  assert.match(page, /\{order\.status\}/);
});

test("legacy read-only orders retain direct and search access with a historical badge", () => {
  assert.match(legacyLoader, /legacySourceTable: \{ not: null \}/);
  assert.match(legacyDetail, />Legacy · read only</);
  assert.match(searchLoader, /legacySourceTable: true/);
});

test("void action authorizes and scopes eligibility inside a row-locked transaction", () => {
  assert.match(button, /voidRepairOrder\(initial, formData\)/);
  assert.match(action, /requirePermission\("void_repair_order"\)/);
  assert.match(action, /legacySourceTable: true/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.match(action, /repairOrderVoidEligibilityError/);
  assert.match(action, /data: \{ status: "void", voidedAt, voidedByUserId: user\?\.id \?\? null, voidReason: reason, voidNote \}/);
  assert.doesNotMatch(action, /repairOrder\.delete/);
});

test("the trailing action area stays compact without changing table overflow behavior", () => {
  assert.match(page, /<div className="overflow-x-auto">/);
  assert.match(page, /<td className="w-14 px-2 py-3\.5 text-right whitespace-nowrap">/);
  assert.doesNotMatch(page, /<th[^>]*>Actions<\/th>/i);
});
