import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanVendorName, normalizeVendorName, validatedVendorName } from "../src/lib/vendors.ts";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(new URL("../prisma/migrations/20260723120000_add_part_vendors/migration.sql", import.meta.url), "utf8");
const actions = await readFile(new URL("../src/app/(app)/repair-orders/part-actions.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/(app)/repair-orders/[id]/page.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/lib/data/repair-orders.ts", import.meta.url), "utf8");
const finalize = await readFile(new URL("../src/app/(app)/repair-orders/finalize-actions.ts", import.meta.url), "utf8");
const combobox = await readFile(new URL("../src/components/vendor-combobox.tsx", import.meta.url), "utf8");
const invoicePrint = await readFile(new URL("../src/app/(app)/invoices/[id]/print/page.tsx", import.meta.url), "utf8");
const repairOrderPrint = await readFile(new URL("../src/app/(app)/repair-orders/[id]/print/page.tsx", import.meta.url), "utf8");
const dailySales = await readFile(new URL("../src/lib/data/daily-sales-query.ts", import.meta.url), "utf8");

test("Vendor names are cleaned and normalized consistently", () => {
  assert.equal(cleanVendorName("  ACME   Auto\t Parts  "), "ACME Auto Parts");
  assert.equal(normalizeVendorName("  AcMe Parts "), "acme parts");
  assert.equal(normalizeVendorName("ACME PARTS"), normalizeVendorName("acme parts"));
  assert.throws(() => validatedVendorName("  \t "), /Enter a Vendor name/);
  assert.throws(() => validatedVendorName("x".repeat(151)), /150 characters or fewer/);
});

test("schema keeps Vendor shop-scoped, unique, and optional on historical lines", () => {
  assert.match(schema, /model Vendor[\s\S]*shopId[\s\S]*normalizedName[\s\S]*@@unique\(\[shopId, normalizedName\]\)/);
  assert.match(schema, /model RepairOrderPart[\s\S]*vendorId\s+String\?/);
  assert.match(schema, /model InvoicePart[\s\S]*vendorNameSnapshot\s+String\?/);
  assert.doesNotMatch(schema, /model InvoicePart[\s\S]*vendorNameSnapshot\s+String\s+@/);
});

test("migration is additive, nullable, protected, and nondestructive", () => {
  assert.match(migration, /CREATE TABLE "vendors"/);
  assert.match(migration, /UNIQUE INDEX "vendors_shop_id_normalized_name_key"/);
  assert.match(migration, /ADD COLUMN "vendor_id" UUID/);
  assert.match(migration, /ADD COLUMN "vendor_name_snapshot" TEXT/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|TRUNCATE|UPDATE)\b/im);
  assert.doesNotMatch(migration, /ADD COLUMN "vendor_(?:id|name_snapshot)"[^;]*NOT NULL/i);
});

test("part actions retain current permission and shop-scope Vendor resolution", () => {
  assert.match(actions, /requirePermission\("edit_draft_repair_order"\)/);
  assert.match(actions, /where: \{ id: vendorId, shopId \}/);
  assert.match(actions, /shopId_normalizedName: \{ shopId, normalizedName:/);
  assert.match(actions, /transaction\.vendor\.upsert/);
  assert.match(actions, /data: \{ \.\.\.values, \.\.\.vendor \}/);
  assert.doesNotMatch(actions, /formData\.get\("shopId"\)/);
  assert.doesNotMatch(actions, /vendor\.delete/);
});

test("Vendor loading and Parts UI remain focused and shop-scoped", () => {
  assert.match(loader, /shopId: membership\.shopId/);
  assert.match(loader, /vendors: \{\s*orderBy: \{ name: "asc" \},\s*select: \{ id: true, name: true \}/);
  assert.match(page, /Description[\s\S]*VendorCombobox[\s\S]*Quantity[\s\S]*Unit price[\s\S]*Add part/);
  assert.match(page, /<fieldset[\s\S]*<PartActionForm action=\{addPartLineWithState\}/);
  assert.doesNotMatch(combobox, /<form/);
});

test("combobox exposes keyboard, mouse, labeling, and explicit button behavior", () => {
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /aria-expanded=\{open\}/);
  assert.match(combobox, /ArrowDown/);
  assert.match(combobox, /ArrowUp/);
  assert.match(combobox, /event\.key === "Enter"/);
  assert.match(combobox, /event\.key === "Escape"/);
  assert.match(combobox, /type="button"/);
  assert.match(combobox, /Add “\{cleanedQuery\}”/);
  assert.match(combobox, /No vendors found/);
});

test("invoice conversion copies only the internal snapshot without changing totals", () => {
  assert.match(finalize, /vendorNameSnapshot: line\.vendorNameSnapshot/);
  assert.doesNotMatch(invoicePrint, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(repairOrderPrint, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(dailySales, /vendorNameSnapshot|Vendor/);
  assert.match(finalize, /partsTotal = order\.parts\.reduce/);
});
