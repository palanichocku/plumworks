import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("schema uses nullable archive timestamps and prevents customer-to-vehicle cascade deletion", async () => {
  const schema = await read("prisma/schema.prisma");
  assert.match(schema, /model Customer[\s\S]*archivedAt\s+DateTime\?/);
  assert.match(schema, /model Vehicle[\s\S]*archivedAt\s+DateTime\?/);
  assert.match(schema, /customer\s+Customer\s+@relation\([^\n]+onDelete: Restrict\)/);
  assert.match(await read("prisma/migrations/20260805120000_add_customer_vehicle_lifecycle/migration.sql"), /customer_legacy_aliases[\s\S]*ON DELETE RESTRICT/);
});

test("one shared predicate defines effective active customer and vehicle availability", async () => {
  const lifecycle = await read("src/lib/customer-vehicle-lifecycle.ts");
  assert.match(lifecycle, /activeCustomerAvailability[\s\S]*archivedAt: null/);
  assert.match(lifecycle, /activeVehicleAvailability[\s\S]*archivedAt: null,[\s\S]*customer: \{ archivedAt: null \}/);
  for (const path of ["src/lib/data/customers.ts", "src/lib/data/vehicles.ts"]) assert.match(await read(path), /LifecycleWhere/);
});

test("repair order selectors and server validation reject archived records", async () => {
  const search = await read("src/app/(app)/repair-orders/customer-search-actions.ts");
  const action = await read("src/app/(app)/repair-orders/actions.ts");
  assert.match(search, /archivedAt: null/);
  assert.match(search, /vehicles: \{[\s\S]*where: \{ archivedAt: null \}/);
  assert.match(action, /customer: \{ archivedAt: null \}/);
});

test("standalone creation reuses authorization and detects archived VIN conflicts", async () => {
  const actions = await read("src/app/(app)/customer-vehicle-create-actions.ts");
  assert.match(actions, /requirePermission\("edit_customer_vehicle"\)/);
  assert.match(actions, /archived vehicle already uses this VIN/);
  assert.match(await read("src/app/(app)/customers/new/page.tsx"), /createCustomer/);
  assert.match(await read("src/app/(app)/vehicles/new/page.tsx"), /createVehicle/);
});

test("lifecycle mutations are tenant scoped, role restricted, and recompute blockers", async () => {
  const actions = await read("src/app/(app)/customer-vehicle-lifecycle-actions.ts");
  assert.match(actions, /membership\.role !== "OWNER"/);
  assert.match(actions, /membership\.role === "STAFF"/);
  assert.match(actions, /shopId: membership\.shopId/g);
  assert.match(actions, /isolationLevel: "Serializable"/);
  assert.match(actions, /confirmation.*"DELETE"/);
  assert.match(actions, /P2003/);
  assert.doesNotMatch(actions, /deleteMany/);
});

test("legacy transforms do not infer archive status", async () => {
  const transform = await read("scripts/lib/customer-vehicle-transform.mjs");
  assert.doesNotMatch(transform, /archivedAt/);
});
