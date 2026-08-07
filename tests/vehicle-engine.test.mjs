import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { vehicleEngineForStorage, VEHICLE_ENGINE_MAX_LENGTH } from "../src/lib/vehicle-fields.ts";
import { reconcileCustomerVehicleRows, vehicleData } from "../scripts/lib/customer-vehicle-transform.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, create, editAction, newVehicle, editPage, detail, vehicleLoader, roAction, roForm, roSearch, roLoader, roPage, roModel, roHtml, roPdf, invoiceModel, invoiceHtml, invoicePdf, lifecycle, cutover] = await Promise.all([
  read("prisma/schema.prisma"), read("src/app/(app)/customer-vehicle-create-actions.ts"), read("src/app/(app)/vehicles/edit-actions.ts"), read("src/app/(app)/vehicles/new/page.tsx"), read("src/app/(app)/vehicles/[id]/edit/page.tsx"), read("src/app/(app)/vehicles/[id]/page.tsx"), read("src/lib/data/vehicles.ts"), read("src/app/(app)/repair-orders/actions.ts"), read("src/components/new-repair-order-form.tsx"), read("src/app/(app)/repair-orders/customer-search-actions.ts"), read("src/lib/data/repair-orders.ts"), read("src/app/(app)/repair-orders/[id]/page.tsx"), read("src/lib/repair-order-document.ts"), read("src/components/repair-order-document-html.tsx"), read("src/components/pdf/repair-order-document-pdf.tsx"), read("src/lib/invoice-document.ts"), read("src/components/invoice-document-html.tsx"), read("src/components/pdf/invoice-document-pdf.tsx"), read("src/app/(app)/customer-vehicle-lifecycle-actions.ts"), read("scripts/legacy-cutover.mjs"),
]);

test("existing nullable Vehicle.engine schema is reused without a new migration", () => {
  assert.match(schema, /model Vehicle \{[\s\S]*engine\s+String\?/);
  assert.equal(VEHICLE_ENGINE_MAX_LENGTH, 100);
});

test("Engine accepts useful free text, trims edges, clears to null, and enforces length", () => {
  for (const value of ["3.5L V6", "2.0L Turbo", "5.7L HEMI", "2.5L Hybrid", "Electric"]) assert.equal(vehicleEngineForStorage(`  ${value}  `), value);
  assert.equal(vehicleEngineForStorage("   "), null);
  assert.equal(vehicleEngineForStorage(null), null);
  assert.equal(vehicleEngineForStorage("x".repeat(100)), "x".repeat(100));
  assert.equal(vehicleEngineForStorage("x".repeat(101)), undefined);
  assert.equal(vehicleEngineForStorage("3.5L   V6"), "3.5L   V6");
});

test("standalone, Customer Add Vehicle, edit, and New RO creation paths persist Engine", () => {
  assert.match(newVehicle, /name="engine"[\s\S]*maxLength=\{100\}[\s\S]*placeholder="3\.5L V6"/);
  assert.match(create, /vehicleEngineForStorage\(formData\.get\("engine"\)\)/);
  assert.match(create, /data: \{[\s\S]*shopId: membership\.shopId[\s\S]*engine/);
  assert.match(editPage, /name="engine"[\s\S]*defaultValue=\{vehicle\.engine \?\? ""\}/);
  assert.match(editAction, /data: \{ year, make, model, engine,/);
  assert.match(roForm, /name="engine"[\s\S]*placeholder="3\.5L V6"/);
  assert.match(roAction, /vehicleEngineForStorage\(formData\.get\("engine"\)\)/);
  assert.match(roAction, /transaction\.vehicle\.create\([\s\S]*engine,/);
});

test("Vehicle detail and both Repair Order summaries show current Engine without stale selection", () => {
  assert.match(vehicleLoader, /getVehicleForEdit[\s\S]*engine: true/);
  assert.match(vehicleLoader, /getVehicleForCurrentShop[\s\S]*engine: true/);
  assert.match(detail, /vehicle\.engine \?\? "Not recorded"/);
  assert.match(roSearch, /engine: string \| null/);
  assert.match(roSearch, /engine: true/);
  assert.match(roForm, /const selectedVehicle = [\s\S]*vehicles\.find/);
  assert.match(roForm, /key=\{selectedVehicle\.id\}[\s\S]*selectedVehicle\.engine \?\? "Not recorded"/);
  assert.match(roLoader, /vehicle: \{[\s\S]*engine: true/);
  assert.match(roPage, /order\.vehicle\.engine \?\? "Not recorded"/);
});

test("Engine remains outside customer-facing Repair Order and Invoice projections", () => {
  for (const source of [roModel, roHtml, roPdf, invoiceModel, invoiceHtml, invoicePdf]) assert.doesNotMatch(source, /\bengine\b|Engine/);
});

test("archive, restore, delete eligibility, searches, and calculations do not depend on Engine", () => {
  assert.doesNotMatch(lifecycle, /engine/i);
  assert.doesNotMatch(roPage.slice(roPage.indexOf("function TotalsSection")), /engine/i);
  assert.doesNotMatch(roSearch.slice(roSearch.indexOf("where:"), roSearch.indexOf("orderBy:")), /engine/i);
});

test("legacy vehicles.DBF MOTOR maps conservatively and rehearsal reports Engine coverage", () => {
  const row = { legacyCustno: "1", legacyCarno: "2", rawData: { MOTOR: "  3.5L   V6  " } };
  assert.equal(vehicleData(row).engine, "3.5L V6");
  assert.equal(vehicleData({ ...row, rawData: { MOTOR: "   " } }).engine, null);
  const result = reconcileCustomerVehicleRows([{ legacyCustno: "1", rawData: { CUSTOMER: "Test Customer" } }], [row]);
  assert.deepEqual(result.engine, { sourceVehiclesEvaluated: 1, sourceValues: 1, destinationValues: 1, missingValues: 0, mismatches: 0, unresolved: 0, ambiguous: 0 });
  for (const label of ["source MOTOR values found", "destination Engine values produced", "Engine mismatches", "unresolved Engine rows", "ambiguous Engine rows"]) assert.match(cutover, new RegExp(label));
});
