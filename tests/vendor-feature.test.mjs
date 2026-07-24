import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildVendorChoices,
  cleanVendorName,
  normalizeVendorName,
  resolveVendorSubmission,
  validatedVendorName,
} from "../src/lib/vendors.ts";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(new URL("../prisma/migrations/20260723120000_add_part_vendors/migration.sql", import.meta.url), "utf8");
const actions = await readFile(new URL("../src/app/(app)/repair-orders/part-actions.ts", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/lib/data/repair-orders.ts", import.meta.url), "utf8");
const finalize = await readFile(new URL("../src/app/(app)/repair-orders/finalize-actions.ts", import.meta.url), "utf8");
const combobox = await readFile(new URL("../src/components/vendor-combobox.tsx", import.meta.url), "utf8");
const invoicePrint = await readFile(new URL("../src/app/(documents)/invoices/[id]/print/page.tsx", import.meta.url), "utf8");
const repairOrderPrint = await readFile(new URL("../src/app/(app)/repair-orders/[id]/print/page.tsx", import.meta.url), "utf8");
const dailySales = await readFile(new URL("../src/lib/data/daily-sales-query.ts", import.meta.url), "utf8");
const partForm = await readFile(new URL("../src/components/part-action-form.tsx", import.meta.url), "utf8");
const lineItems = await readFile(new URL("../src/components/repair-order-line-items.tsx", import.meta.url), "utf8");

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
  assert.match(lineItems, /Description[\s\S]*VendorCombobox[\s\S]*Quantity[\s\S]*Unit price[\s\S]*ariaLabel="Add part"/);
  assert.match(lineItems, /<PartActionForm action=\{addPartLineWithState\}/);
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
  assert.match(combobox, /Add “\{choice\.name\}”/);
  assert.match(combobox, /No vendors found/);
});

test("blank input lists existing Vendors and remains optional when none exist", () => {
  const vendors = [{ id: "one", name: "Auto Zone" }, { id: "two", name: "NAPA" }];
  assert.deepEqual(buildVendorChoices(vendors, "").choices, vendors.map((vendor) => ({ type: "existing", vendor })));
  assert.deepEqual(buildVendorChoices([], "").choices, []);
  assert.match(combobox, /No vendors found\. Type a name to add one\./);
  assert.match(actions, /return \{ vendorId: null, vendorNameSnapshot: null \}/);
});

test("typing filters case-insensitively and puts the visible Add choice first", () => {
  const vendors = [{ id: "one", name: "Auto Zone" }, { id: "two", name: "NAPA" }];
  const result = buildVendorChoices(vendors, "zone plus");
  assert.equal(result.filteredVendors.length, 0);
  assert.deepEqual(result.choices[0], { type: "new", name: "zone plus" });
  const partial = buildVendorChoices(vendors, "auto");
  assert.deepEqual(partial.choices[0], { type: "new", name: "auto" });
  assert.equal(partial.choices[1].vendor.id, "one");
});

test("normalized exact matches suppress Add and resolve the existing Vendor", () => {
  const vendors = [{ id: "existing-id", name: "Auto Zone" }];
  for (const query of ["Auto Zone", "auto zone", "AUTO   ZONE", " Auto Zone "]) {
    const result = buildVendorChoices(vendors, query);
    assert.equal(result.canAdd, false);
    assert.equal(result.exactVendor?.id, "existing-id");
    assert.equal(result.choices.some((choice) => choice.type === "new"), false);
  }
});

test("mouse and Enter select the highlighted Add candidate and submit new name only", () => {
  assert.match(combobox, /if \(choice\?\.type === "new"\) chooseNew\(\)/);
  assert.match(combobox, /event\.key === "Enter"[\s\S]*chooseActive\(\)/);
  assert.match(combobox, /onClick=\{chooseNew\}/);
  assert.match(combobox, /function chooseNew\(\)[\s\S]*setVendorId\(""\);[\s\S]*setNewVendorName\(cleanedQuery\)/);
  assert.match(combobox, /name="vendorId" value=\{vendorId\}/);
  assert.match(combobox, /name="newVendorName" value=\{newVendorName\}/);
});

test("existing selection submits only its ID and clearing submits neither field", () => {
  assert.match(combobox, /function chooseExisting[\s\S]*setVendorId\(vendor\.id\);[\s\S]*setNewVendorName\(""\)/);
  assert.match(combobox, /onChange[\s\S]*setVendorId\(nextExactVendor\?\.id \?\? ""\);[\s\S]*setNewVendorName\(""\)/);
  assert.equal(buildVendorChoices([], "").cleanedQuery, "");
});

test("direct submission resolves blank, exact, and new Vendor input exclusively", () => {
  const vendors = [{ id: "existing-id", name: "Quacker" }];

  assert.deepEqual(resolveVendorSubmission(vendors, "   "), {
    vendorId: "",
    newVendorName: "",
    vendorInput: "",
  });

  for (const query of ["Quacker", "quacker", "QUACKER", " Quacker ", "Quacker   "]) {
    assert.deepEqual(resolveVendorSubmission(vendors, query), {
      vendorId: "existing-id",
      newVendorName: "",
      vendorInput: "Quacker",
    });
  }

  assert.deepEqual(resolveVendorSubmission(vendors, "  Quacker   Supply  "), {
    vendorId: "",
    newVendorName: "Quacker Supply",
    vendorInput: "Quacker Supply",
  });
});

test("form submission synchronously writes the resolved Vendor controls", () => {
  assert.match(combobox, /form\.addEventListener\("submit", resolveSubmittedVendor, true\)/);
  assert.match(combobox, /resolveVendorSubmission\(vendors, inputRef\.current\?\.value \?\? ""\)/);
  assert.match(combobox, /vendorIdInputRef\.current\.value = resolved\.vendorId/);
  assert.match(combobox, /newVendorNameInputRef\.current\.value = resolved\.newVendorName/);
  assert.doesNotMatch(
    combobox.slice(combobox.indexOf("function resolveSubmittedVendor"), combobox.indexOf("form.addEventListener")),
    /setVendorId|setNewVendorName|setQuery/,
  );
});

test("dropdown remains above the unclipped Parts rows on Add and Update forms", () => {
  assert.match(combobox, /focus-within:z-40/);
  assert.match(combobox, /absolute left-0 z-50/);
  assert.match(combobox, /max-w-\[min\(20rem,calc\(100vw-2rem\)\)\]/);
  assert.doesNotMatch(lineItems.slice(lineItems.indexOf("RepairOrderPartsCard"), lineItems.indexOf("RepairOrderLaborCard")), /overflow-hidden|overflow-x-hidden|overflow-y-hidden/);
  assert.equal((lineItems.match(/<VendorCombobox/g) ?? []).length, 2);
  assert.match(lineItems, /defaultVendor=\{line\.vendor\}/);
});

test("recoverable action errors retain the controlled Vendor input", () => {
  assert.match(combobox, /value=\{query\}/);
  assert.match(partForm, /state\.status === "error"/);
  assert.doesNotMatch(partForm, /reset\(|key=/);
});

test("invoice conversion copies only the internal snapshot without Vendor affecting totals", () => {
  assert.match(finalize, /vendorNameSnapshot: line\.vendorNameSnapshot/);
  assert.doesNotMatch(invoicePrint, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(repairOrderPrint, /vendorNameSnapshot|Vendor/);
  assert.doesNotMatch(dailySales, /vendorNameSnapshot|Vendor/);
  assert.match(finalize, /calculateEditableInvoiceTotals/);
  assert.match(finalize, /calculateEditableInvoiceTotals\(\{[\s\S]*parts: order\.parts,[\s\S]*labor: order\.labor/);
});
