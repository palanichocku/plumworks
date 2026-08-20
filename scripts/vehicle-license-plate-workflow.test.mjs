import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Repair Order, Vehicle, and Customer pages share one Vehicle license plate editor", async () => {
  const [component, repairOrder, vehicle, customer] = await Promise.all([
    read("src/components/vehicle-license-plate-field.tsx"),
    read("src/app/(app)/repair-orders/[id]/page.tsx"),
    read("src/app/(app)/vehicles/[id]/page.tsx"),
    read("src/app/(app)/customers/[id]/page.tsx"),
  ]);
  assert.match(component, /action=\{updateVehicleLicensePlate\}/);
  assert.match(component, /name="licensePlate" maxLength=\{30\}/);
  assert.match(repairOrder, /context="repair-order" contextId=\{order\.id\}/);
  assert.match(vehicle, /context="vehicle" contextId=\{vehicle\.id\}/);
  assert.match(customer, /context="customer" contextId=\{customer\.id\}/);
  assert.match(customer, /canEditVehicles && !vehicle\.archivedAt/);
});

test("license plate action validates tenant, lifecycle, and page relationship before updating Vehicle only", async () => {
  const action = await read("src/app/(app)/vehicle-license-plate-actions.ts");
  assert.match(action, /requirePermission\("edit_customer_vehicle"\)/);
  assert.match(action, /id: vehicleId, shopId: membership\.shopId, archivedAt: null, customer: \{ shopId: membership\.shopId, archivedAt: null \}/);
  assert.match(action, /contextId !== vehicle\.customerId/);
  assert.match(action, /vehicleId, status: \{ in: \["draft", "open"\] \}, invoices: \{ none: \{\} \}/);
  assert.match(action, /data: \{ licensePlate: storedPlate \}/);
  assert.doesNotMatch(action, /partsTotal|laborTotal|taxTotal|estimatedTotal|shopSupplies|Invoice/);
});

test("plate remains a dynamic Vehicle field while Invoice documents retain existing snapshot semantics", async () => {
  const [schema, repairData, invoiceDocument] = await Promise.all([
    read("prisma/schema.prisma"),
    read("src/lib/data/repair-orders.ts"),
    read("src/lib/invoice-document.ts"),
  ]);
  assert.match(schema, /model Vehicle \{[\s\S]*?licensePlate\s+String\?\s+@map\("license_plate"\)/);
  assert.doesNotMatch(schema, /model RepairOrder \{[\s\S]*?licensePlate/);
  assert.match(repairData, /vehicle: \{[\s\S]*?licensePlate: true/);
  assert.match(invoiceDocument, /snapshotString\(invoice\.vehicleSnapshot, "licensePlate", vehicle\?\.licensePlate \?\? null\)/);
});
