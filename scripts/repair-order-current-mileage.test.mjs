import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repairOrderMileageForStorage } from "../src/lib/repair-order-mileage.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("current Repair Order mileage accepts a valid reading and preserves blank as null", () => {
  assert.equal(repairOrderMileageForStorage("84120"), 84120);
  assert.equal(repairOrderMileageForStorage(""), null);
  assert.equal(repairOrderMileageForStorage("12.5"), undefined);
  assert.equal(repairOrderMileageForStorage("10000001"), undefined);
});

test("new RO separates historical reference mileage from blank current mileage", async () => {
  const [form, search, mileage] = await Promise.all([read("src/components/new-repair-order-form.tsx"), read("src/app/(app)/repair-orders/customer-search-actions.ts"), read("src/lib/data/vehicle-mileage.ts")]);
  assert.match(form, /Last recorded mileage/);
  assert.match(form, /Current mileage/);
  assert.match(form, /placeholder="Enter current mileage"/);
  assert.match(form, /key=\{`\$\{vehicleMode\}:\$\{vehicleId\}`\}/);
  assert.match(search, /getLastRecordedMileageForVehicles\(membership\.shopId/);
  assert.match(mileage, /legacy_source_table IS NULL AND status = 'closed' AND closed_at IS NOT NULL/);
  assert.match(mileage, /legacy_source_table IS NOT NULL AND invoice_date IS NOT NULL/);
});

test("editable RO mileage is locked, tenant scoped, operational-only, and auditable", async () => {
  const [action, field, page] = await Promise.all([read("src/app/(app)/repair-orders/actions.ts"), read("src/components/repair-order-mileage-field.tsx"), read("src/app/(app)/repair-orders/[id]/page.tsx")]);
  assert.match(action, /export async function updateRepairOrderMileage/);
  assert.match(action, /requirePermission\("edit_draft_repair_order"\)/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /operationalRepairOrderWhere\(membership\.shopId\)/);
  assert.match(action, /data: \{ odometer \}/);
  assert.match(action, /isolationLevel: "Serializable"/);
  assert.match(field, /defaultValue=\{mileage \?\? ""\}/);
  assert.match(page, /Last recorded mileage/);
  assert.doesNotMatch(page, /order\.odometer\?\.toLocaleString\(\) \?\? order\.vehicle\.odometer/);
});

test("historical mileage remains read-only and vehicle reassignment clears only current RO mileage", async () => {
  const [action, reassignment, mileage] = await Promise.all([read("src/app/(app)/repair-orders/actions.ts"), read("src/app/(app)/repair-orders/reassignment-actions.ts"), read("src/lib/data/vehicle-mileage.ts")]);
  assert.doesNotMatch(action, /vehicle\.update[\s\S]*odometer/);
  assert.match(reassignment, /vehicleChanged \? \{ odometer: null \} : \{\}/);
  assert.doesNotMatch(reassignment, /transaction\.vehicle\.update/);
  assert.doesNotMatch(mileage, /UPDATE|DELETE|INSERT/i);
});
