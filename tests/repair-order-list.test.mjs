import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/app/(app)/repair-orders/page.tsx", import.meta.url), "utf8");
const button = await readFile(new URL("../src/components/delete-repair-order-button.tsx", import.meta.url), "utf8");
const action = await readFile(new URL("../src/app/(app)/repair-orders/delete-actions.ts", import.meta.url), "utf8");

test("Repair Order list keeps its data headings and has no visible Actions heading", () => {
  for (const heading of ["RO # / Date", "Customer", "Vehicle", "Status / Scope", "Estimated Total"]) {
    assert.match(page, new RegExp(`>${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}<`));
  }
  assert.doesNotMatch(page, />Actions</i);
  assert.match(page, /<th aria-label="Row actions" className="w-14 px-2 py-3">/);
});

test("compact Repair Order delete uses the shared trash-bin shape and accessible control", () => {
  assert.doesNotMatch(button, /⌫/);
  assert.match(button, /<path d="M3 6h18"/);
  assert.match(button, /<path d="M19 6l-1 14H6L5 6"/);
  assert.match(button, /title="Delete repair order" ariaLabel="Delete repair order"/);
  assert.match(button, /inline-flex h-10 w-10/);
  assert.match(button, /focus:ring-4 focus:ring-red-100/);
  assert.match(button, /confirmTitle="Delete this draft repair order\?"/);
});

test("only currently deletable list rows render the compact delete control", () => {
  assert.match(page, /const imported = Boolean\(order\.legacySourceTable\)/);
  assert.match(page, /hasPermission\(membership\.role, "delete_draft_repair_order"\)/);
  assert.match(page, /!imported && canDelete \? \(/);
  assert.match(page, /<DeleteRepairOrderButton repairOrderId=\{order\.id\} compact \/>/);
  assert.match(page, /\) : null\}/);
  assert.doesNotMatch(page, />—</);
});

test("delete action and server authorization remain unchanged and authoritative", () => {
  assert.match(button, /action=\{deleteDraftRepairOrder\}/);
  assert.match(action, /requirePermission\("delete_draft_repair_order"\)/);
  assert.match(action, /legacySourceTable: null/);
  assert.match(action, /invoices: \{ none: \{\} \}/);
});

test("the trailing action area stays compact without changing table overflow behavior", () => {
  assert.match(page, /<div className="overflow-x-auto">/);
  assert.match(page, /<td className="w-14 px-2 py-3\.5 text-right whitespace-nowrap">/);
  assert.doesNotMatch(page, /<th[^>]*>Actions<\/th>/i);
});
