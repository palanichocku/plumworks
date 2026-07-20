import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canPreviewRepairOrderLayout,
  optionalRepairOrderText,
  resolveRepairOrderLayout,
} from "../src/lib/repair-order-layout.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("repair-order schema and additive migration support both optional text fields", async () => {
  const [schema, migration] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260719223000_add_repair_order_concerns/migration.sql"),
  ]);
  assert.match(schema, /customerComplaint\s+String\?\s+@map\("customer_complaint"\) @db\.Text/);
  assert.match(schema, /recommendation\s+String\?\s+@db\.Text/);
  assert.match(migration, /ADD COLUMN "customer_complaint" TEXT/);
  assert.match(migration, /ADD COLUMN "recommendation" TEXT/);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|RENAME/i);
});

test("optional multiline values preserve formatting and permit empty values", () => {
  assert.equal(optionalRepairOrderText(null), null);
  assert.equal(optionalRepairOrderText(" \n "), null);
  assert.equal(optionalRepairOrderText("First line\n  second line\n"), "First line\n  second line\n");
});

test("only owner and admin can select previews; staff is forced to classic", () => {
  assert.equal(canPreviewRepairOrderLayout("OWNER"), true);
  assert.equal(canPreviewRepairOrderLayout("ADMIN"), true);
  assert.equal(canPreviewRepairOrderLayout("STAFF"), false);
  assert.equal(resolveRepairOrderLayout("STAFF", "split"), "classic");
  assert.equal(resolveRepairOrderLayout("OWNER", "guided"), "guided");
});

test("all layouts share one mounted section tree and concerns precede parts", async () => {
  const [source, helper] = await Promise.all([
    read("src/components/repair-order-layout-preview.tsx"),
    read("src/lib/repair-order-layout.ts"),
  ]);
  assert.equal((source.match(/data-ro-section="concerns"/g) ?? []).length, 1);
  assert.equal((source.match(/data-ro-section="parts"/g) ?? []).length, 1);
  assert.ok(source.indexOf('data-ro-section="concerns"') < source.indexOf('data-ro-section="parts"'));
  assert.match(source, /useState<RepairOrderLayout>\("classic"\)/);
  assert.match(helper, /role === "OWNER" \|\| role === "ADMIN"/s);
});

test("classic actions wrap within the card and split uses one responsive customer-vehicle grid", async () => {
  const form = await read("src/components/new-repair-order-form.tsx");
  assert.match(form, /data-ro-section="actions"/);
  assert.match(form, /sm:flex-wrap/);
  assert.match(form, /basis-80/);
  assert.match(form, /sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end/);
  assert.match(form, /max-w-full[^"]*whitespace-normal/);
  assert.doesNotMatch(form, /absolute[^\n]*Save Document Draft/);

  const gridStart = form.indexOf('data-ro-section="customer-vehicle-grid"');
  const customer = form.indexOf("Customer Information", gridStart);
  const vehicle = form.indexOf("Vehicle Assignment", gridStart);
  const gridEnd = form.indexOf("</div>", vehicle);
  assert.ok(gridStart >= 0 && customer > gridStart && vehicle > customer && gridEnd > vehicle);
  assert.match(form.slice(gridStart - 160, gridStart + 80), /grid items-start gap-6 lg:grid-cols-2/);
  assert.equal((form.match(/Customer Information/g) ?? []).length, 1);
  assert.equal((form.match(/Vehicle Assignment/g) ?? []).length, 1);
  assert.equal((form.match(/name="customerComplaint"/g) ?? []).length, 1);
  assert.equal((form.match(/name="recommendation"/g) ?? []).length, 1);
});

test("customer locality fields use a readable responsive city-state-postal grid", async () => {
  const form = await read("src/components/new-repair-order-form.tsx");
  assert.match(form, /data-ro-section="customer-locality-grid"/);
  assert.match(form, /grid-cols-1/);
  assert.match(form, /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(5rem,7rem\)_minmax\(8rem,10rem\)\]/);
  assert.match(form, /block whitespace-nowrap[^>]*htmlFor="customer-postal-code">Postal Code<\/label>/);
  assert.doesNotMatch(form, /col-span-1\.5/);
  assert.match(form, /<div className="min-w-0">\s*<label[^>]*htmlFor="customer-city">City<\/label>\s*<input id="customer-city"/);
  assert.match(form, /<div className="min-w-0">\s*<label[^>]*htmlFor="customer-state">State<\/label>\s*<input id="customer-state"/);
  assert.match(form, /<div className="min-w-0">\s*<label[^>]*htmlFor="customer-postal-code">Postal Code<\/label>\s*<input id="customer-postal-code"/);
  assert.equal((form.match(/name="city"/g) ?? []).length, 1);
  assert.equal((form.match(/name="state"/g) ?? []).length, 1);
  assert.equal((form.match(/name="postalCode"/g) ?? []).length, 1);
});

test("create and edit use the shared fields and existing scoped submission paths", async () => {
  const [actions, form, loader] = await Promise.all([
    read("src/app/(app)/repair-orders/actions.ts"),
    read("src/components/new-repair-order-form.tsx"),
    read("src/lib/data/repair-orders.ts"),
  ]);
  assert.match(actions, /createRepairOrder[\s\S]*customerComplaint,[\s\S]*recommendation,/);
  assert.match(actions, /updateRepairOrderConcerns[\s\S]*requirePermission\("edit_draft_repair_order"\)/);
  assert.match(actions, /shopId: membership\.shopId/);
  assert.equal((form.match(/action=\{createRepairOrder\}/g) ?? []).length, 1);
  assert.match(loader, /customerComplaint: true,[\s\S]*recommendation: true/);
});

test("detail and print views preserve lines and hide empty read-only sections", async () => {
  const [detail, printable] = await Promise.all([
    read("src/app/(app)/repair-orders/[id]/page.tsx"),
    read("src/app/(app)/repair-orders/[id]/print/page.tsx"),
  ]);
  assert.match(detail, /if \(!editable && !order\.customerComplaint && !order\.recommendation\) return null/);
  assert.match(detail, /whitespace-pre-wrap/g);
  assert.match(printable, /order\.customerComplaint \|\| order\.recommendation/);
  assert.match(printable, /whitespace-pre-wrap/g);
});
