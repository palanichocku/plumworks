import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { canEditInternalNotes, MAX_INTERNAL_NOTES_LENGTH, normalizeInternalNotes } from "../src/lib/internal-notes.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Customer and Vehicle reuse their existing nullable notes fields without a new migration", async () => {
  const [schema, migration, directories] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260714023924_add_customer_vehicle_clean_fields/migration.sql"),
    readdir(new URL("prisma/migrations/", root)),
  ]);
  assert.match(schema, /model Customer[\s\S]*?notes\s+String\?/);
  assert.match(schema, /model Vehicle[\s\S]*?notes\s+String\?/);
  assert.equal((migration.match(/ADD COLUMN\s+"notes" TEXT/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|RENAME|DEFAULT/i);
  assert.equal(directories.filter((name) => /customer.*vehicle.*notes|internal.*notes/i.test(name)).length, 0);
});

test("notes normalization preserves internal line breaks, trims edges, nulls blanks, and caps length", () => {
  assert.deepEqual(normalizeInternalNotes("  first line\n  second line  "), { notes: "first line\n  second line" });
  assert.deepEqual(normalizeInternalNotes(" \n "), { notes: null });
  assert.match(normalizeInternalNotes("x".repeat(MAX_INTERNAL_NOTES_LENGTH + 1)).error, /5,000/);
});

test("OWNER and ADMIN can edit internal notes while STAFF cannot", () => {
  assert.equal(canEditInternalNotes("OWNER"), true);
  assert.equal(canEditInternalNotes("ADMIN"), true);
  assert.equal(canEditInternalNotes("STAFF"), false);
});

test("detail loaders select notes only for tenant-scoped detail records", async () => {
  const [customers, vehicles] = await Promise.all([read("src/lib/data/customers.ts"), read("src/lib/data/vehicles.ts")]);
  assert.match(customers, /getCustomerForCurrentShop[\s\S]*shopId: membership\.shopId[\s\S]*notes: true/);
  assert.match(vehicles, /getVehicleForCurrentShop[\s\S]*shopId: membership\.shopId[\s\S]*notes: true/);
  assert.doesNotMatch(customers.slice(customers.indexOf("getCustomersForCurrentShop"), customers.indexOf("getCustomerForCurrentShop")), /notes: true/);
  assert.doesNotMatch(vehicles.slice(vehicles.indexOf("getVehiclesForCurrentShop"), vehicles.indexOf("getVehicleForEdit")), /notes: true/);
});

test("server actions are tenant scoped, role guarded, size checked, and never audit note contents", async () => {
  const actions = await read("src/app/(app)/internal-notes-actions.ts");
  assert.match(actions, /requirePermission\("edit_customer_vehicle"\)/);
  assert.match(actions, /canEditInternalNotes\(result\.membership\.role\)/);
  assert.equal((actions.match(/shopId: membership\.shopId/g) ?? []).length, 2);
  assert.match(actions, /normalizeInternalNotes\(formData\.get\("notes"\)\)/);
  assert.doesNotMatch(actions, /metadata[^\n]*parsed\.notes|console\.(?:log|error)[^\n]*notes/i);
});

test("Customer and Vehicle notes blocks expose accessible save feedback and staff read-only states", async () => {
  const [block, customerPage, vehiclePage] = await Promise.all([read("src/components/internal-notes-block.tsx"), read("src/app/(app)/customers/[id]/page.tsx"), read("src/app/(app)/vehicles/[id]/page.tsx")]);
  assert.match(block, /Internal Notes/);
  assert.match(block, /Visible only to authorized shop users\./);
  assert.match(block, /whitespace-pre-wrap/);
  assert.match(block, /maxLength=\{5000\}/);
  assert.match(block, /type="submit" disabled=\{pending\}/);
  assert.match(block, /pending \? "Saving…" : "Save Notes"/);
  assert.match(block, /role="status" aria-live="polite"/);
  assert.match(block, /onChange=\{\(\) => setDirty\(true\)\}/);
  assert.match(customerPage, /No customer notes have been added\./);
  assert.match(customerPage, /Customer notes saved\./);
  assert.match(vehiclePage, /No vehicle notes have been added\./);
  assert.match(vehiclePage, /Vehicle notes saved\./);
});

test("internal notes are excluded from invoice, print, public, and Daily Sales models", async () => {
  const paths = ["src/lib/data/invoices.ts", "src/lib/daily-sales-report-model.ts", "src/lib/data/daily-sales-query.ts", "src/app/(app)/invoices/[id]/print/page.tsx", "src/app/(app)/repair-orders/[id]/print/page.tsx"];
  const sources = await Promise.all(paths.map(read));
  for (const source of sources) {
    assert.doesNotMatch(source, /customer\.notes|vehicle\.notes|customerNotes|vehicleNotes/);
  }
});
