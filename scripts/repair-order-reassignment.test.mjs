import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("reassignment is authenticated, tenant scoped, operational-only, locked, and invoice-safe", async () => {
  const action = await read("src/app/(app)/repair-orders/reassignment-actions.ts");
  assert.match(action, /requirePermission\("edit_draft_repair_order"\)/);
  assert.match(action, /FOR UPDATE/);
  assert.match(action, /operationalRepairOrderWhere\(membership\.shopId\)/);
  assert.match(action, /invoices: \{ some: \{\} \}/);
  assert.match(action, /already been invoiced/);
  assert.match(action, /customerId, shopId: membership\.shopId, archivedAt: null/);
  assert.match(action, /vehicleId, shopId: membership\.shopId, archivedAt: null/);
  assert.match(action, /isolationLevel: "Serializable"/);
});

test("customer-only preserves mileage and vehicle changes clear only RO mileage", async () => {
  const action = await read("src/app/(app)/repair-orders/reassignment-actions.ts");
  assert.match(action, /vehicleChanged \? \{ odometer: null \} : \{\}/);
  const vehicleUpdate = action.match(/transaction\.vehicle\.update\([^\n]+/)?.[0] ?? "";
  assert.doesNotMatch(vehicleUpdate, /odometer/);
  assert.match(action, /Vehicle changed\. Enter the mileage for the replacement vehicle/);
});

test("customer and vehicle ownership remains consistent without ownership mutations", async () => {
  const [action, dialog] = await Promise.all([read("src/app/(app)/repair-orders/reassignment-actions.ts"), read("src/components/repair-order-assignment-dialog.tsx")]);
  assert.match(action, /vehicle\.customerId !== customerId/);
  assert.match(action, /selected vehicle does not belong to the selected customer/);
  assert.doesNotMatch(action, /transaction\.vehicle\.(update|create|delete)/);
  assert.match(dialog, /nextCustomerId = mode === "vehicle" && vehicle \? vehicle\.customerId/);
  assert.match(dialog, /Continuing will use \{vehicle\.customer\.displayName\} \+ this vehicle/);
});

test("stale submissions fail before mutation and unrelated RO work is never rewritten", async () => {
  const action = await read("src/app/(app)/repair-orders/reassignment-actions.ts");
  assert.match(action, /order\.customerId !== expectedCustomerId \|\| order\.vehicleId !== expectedVehicleId/);
  assert.match(action, /changed while the dialog was open/);
  const repairOrderUpdate = action.match(/transaction\.repairOrder\.update\([^\n]+/)?.[0] ?? "";
  assert.doesNotMatch(repairOrderUpdate, /parts:|labor:|notes:|customerComplaint:|recommendation:|partsTotal:|laborTotal:/);
});

test("audit follows the existing optional operational policy with before/after IDs", async () => {
  const action = await read("src/app/(app)/repair-orders/reassignment-actions.ts");
  assert.match(action, /repair_order_assignment_corrected/);
  assert.match(action, /changes\.customerId = \{ from: order\.customerId, to: customerId \}/);
  assert.match(action, /changes\.vehicleId = \{ from: order\.vehicleId, to: vehicleId \}/);
  assert.match(action, /category: "operational", enabled: membership\.shop\.auditLoggingEnabled/);
});

test("invoice conversion snapshots corrected current RO relationships atomically", async () => {
  const conversion = await read("src/app/(app)/repair-orders/finalize-actions.ts");
  assert.match(conversion, /FOR UPDATE/);
  assert.match(conversion, /customerId: order\.customerId/);
  assert.match(conversion, /vehicleId: order\.vehicleId/);
  assert.match(conversion, /accountsReceivable:[\s\S]*customerId: order\.customerId/);
});

test("history data remains relationship-driven rather than copied from original RO assignment", async () => {
  const [customers, vehicles, history] = await Promise.all([read("src/lib/data/customers.ts"), read("src/lib/data/vehicles.ts"), read("src/lib/data/repair-order-history.ts")]);
  assert.match(customers, /repairOrders|invoices/); assert.match(vehicles, /repairOrders|invoices/); assert.match(history, /customerId|vehicleId/);
});

test("UI reuses customer search, searches identifying vehicle fields, confirms, and refreshes", async () => {
  const [dialog, action, page] = await Promise.all([read("src/components/repair-order-assignment-dialog.tsx"), read("src/app/(app)/repair-orders/reassignment-actions.ts"), read("src/app/(app)/repair-orders/[id]/page.tsx")]);
  assert.match(dialog, /RepairOrderCustomerCombobox/); assert.match(dialog, /Year, make, model, VIN, plate, or owner/);
  assert.match(dialog, /All existing labor, parts, notes/); assert.match(dialog, /router\.refresh\(\)/);
  assert.match(action, /licensePlate:[\s\S]*vin:[\s\S]*customer:[\s\S]*displayName/);
  assert.match(page, /editable && !invoice/);
});

test("customer correction offers only selected-customer vehicles and handles no-vehicle customers", async () => {
  const dialog = await read("src/components/repair-order-assignment-dialog.tsx");
  assert.match(dialog, /customer\.vehicles\.map/);
  assert.match(dialog, /item\.id === current\.vehicleId \? "Keep " : ""/);
  assert.match(dialog, /The current vehicle belongs to another customer/);
  assert.match(dialog, /No vehicles are currently recorded for/);
  assert.match(dialog, /setAddingVehicle\(true\)/);
  assert.doesNotMatch(dialog, /vehicles\/new/);
  assert.doesNotMatch(dialog, /associate it with/);
});

test("inline vehicle creation preserves RO context and automatically selects the result", async () => {
  const dialog = await read("src/components/repair-order-assignment-dialog.tsx");
  assert.match(dialog, /createRepairOrderCorrectionVehicle\(formData\)/);
  assert.match(dialog, /vehicles: \[\.\.\.selected\.vehicles, result\.vehicle\]/);
  assert.match(dialog, /setVehicle\(result\.vehicle\)/);
  assert.match(dialog, /setAddingVehicle\(false\)/);
  assert.match(dialog, /onClick=\{\(\) => \{ setAddingVehicle\(false\)/);
});

test("normal and inline vehicle creation share validation, tenant, and duplicate handling", async () => {
  const [shared, normal, correction] = await Promise.all([read("src/lib/vehicle-creation.ts"), read("src/app/(app)/customer-vehicle-create-actions.ts"), read("src/app/(app)/repair-orders/reassignment-actions.ts")]);
  assert.match(normal, /createVehicleForShop\(membership\.shopId, formData\)/);
  assert.match(correction, /createVehicleForShop\(membership\.shopId, formData\)/);
  assert.match(shared, /id: customerId, shopId, archivedAt: null/);
  assert.match(shared, /vin: \{ equals: vin, mode: "insensitive" \}/);
  assert.match(shared, /Select the existing vehicle instead/);
});

test("creating a vehicle does not mutate the RO or clear its mileage", async () => {
  const shared = await read("src/lib/vehicle-creation.ts");
  assert.doesNotMatch(shared, /repairOrder/);
  assert.doesNotMatch(shared, /transaction\.repairOrder|prisma\.repairOrder/);
});

test("vehicle correction identifies owner and explicitly derives a cross-owner customer change", async () => {
  const dialog = await read("src/components/repair-order-assignment-dialog.tsx");
  assert.match(dialog, /Owner: \{item\.customer\.displayName\}/);
  assert.match(dialog, /This vehicle belongs to \{vehicle\.customer\.displayName\}/);
  assert.match(dialog, /nextCustomerId = mode === "vehicle" && vehicle \? vehicle\.customerId/);
});

test("legacy repair orders remain excluded", async () => {
  const [lifecycle, page] = await Promise.all([read("src/lib/repair-order-lifecycle.ts"), read("src/lib/data/repair-orders.ts")]);
  assert.match(lifecycle, /legacySourceTable: null/); assert.match(page, /legacySourceTable: null/);
});
