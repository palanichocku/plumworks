import assert from "node:assert/strict";
import test from "node:test";

import { automotiveAssetDisplayLabel, toAutomotiveAssetContext } from "../src/lib/verticals/automotive/asset-context.ts";
import { automotiveWorkOrderDisplayNumber, automotiveWorkOrderHref, toAutomotiveWorkOrderContext } from "../src/lib/verticals/automotive/work-order-context.ts";

test("Vehicle data maps to a read-only automotive AssetContext", () => {
  const context = toAutomotiveAssetContext({
    id: "vehicle-1",
    customerId: "customer-1",
    year: 2020,
    make: "Honda",
    model: "Accord",
    engine: "2.0L",
    vin: "VIN123",
    licensePlate: "ABC123",
    odometer: 54321,
    archivedAt: null,
    customerArchivedAt: null,
  });
  assert.deepEqual(context, {
    id: "vehicle-1",
    customerId: "customer-1",
    displayLabel: "2020 Honda Accord",
    secondaryLabel: "ABC123",
    archived: false,
    details: [
      { label: "Year", value: "2020" },
      { label: "Make", value: "Honda" },
      { label: "Model", value: "Accord" },
      { label: "Engine", value: "2.0L" },
      { label: "VIN", value: "VIN123" },
      { label: "License plate", value: "ABC123" },
      { label: "Odometer", value: "54321" },
    ],
  });
});

test("optional Vehicle values remain safe and customer archival affects availability", () => {
  assert.equal(automotiveAssetDisplayLabel({ year: null, make: " ", model: null }), "Vehicle details unavailable");
  const archived = toAutomotiveAssetContext({ id: "vehicle-2", customerId: "customer-2", vin: " VIN456 ", customerArchivedAt: new Date("2026-01-01T00:00:00Z") });
  assert.equal(archived.displayLabel, "Vehicle details unavailable");
  assert.equal(archived.secondaryLabel, "VIN456");
  assert.equal(archived.archived, true);
  assert.deepEqual(archived.details, [{ label: "VIN", value: "VIN456" }]);
});

test("RepairOrder data maps to an automotive WorkOrderContext", () => {
  const openedAt = new Date("2026-08-27T12:00:00Z");
  assert.deepEqual(toAutomotiveWorkOrderContext({ id: "order-1", repairOrderNumber: 21759, legacyRoNo: null, legacySourceTable: null, status: "open", customerId: "customer-1", vehicleId: "vehicle-1", openedAt }), {
    id: "order-1",
    number: "21759",
    status: "open",
    customerId: "customer-1",
    assetId: "vehicle-1",
    openedAt,
    href: "/repair-orders/order-1",
  });
});

test("legacy display identity and current routes are preserved", () => {
  assert.equal(automotiveWorkOrderDisplayNumber({ repairOrderNumber: null, legacyRoNo: " 18181 " }), "18181");
  assert.equal(automotiveWorkOrderDisplayNumber({ repairOrderNumber: null, legacyRoNo: null }), "Not recorded");
  assert.equal(automotiveWorkOrderHref({ id: "legacy-order", legacySourceTable: "orders" }), "/open-orders/legacy-order");
  assert.equal(automotiveWorkOrderHref({ id: "operational-order", legacySourceTable: null }), "/repair-orders/operational-order");
});
