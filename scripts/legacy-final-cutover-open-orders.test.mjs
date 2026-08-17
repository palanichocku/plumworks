import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { projectFinalCutoverOpenOrders } from "./lib/legacy-open-order-projection.mjs";
import { readLegacyOpenOrderHeaders } from "./lib/legacy-open-order-header.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const customer = { id: "customer-1", legacyCustno: "C1" };
const vehicle = { id: "vehicle-1", customerId: customer.id, legacyCarno: "V1" };
const settings = {
  defaultTaxRate: "0.06", partsTaxable: true, laborTaxable: false,
  shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "25",
  shopSuppliesTaxable: true,
};

function part(ro = "22000", overrides = {}) {
  return {
    legacyRowKey: `orders:${ro}:1`, legacyRoNo: ro, legacyCustno: "C1", legacyCarno: "V1",
    rawData: { RO_DATE: "20260814", ODOMETER: "48,220", DESC: "Oil filter", PARTNO: "OF-1", QTY: "2", PRICE: "10.10", SOURCE: "Vendor A" },
    ...overrides,
  };
}

function labor(ro = "22000", overrides = {}) {
  return {
    legacyRowKey: `labor:${ro}:1`, legacyRoNo: ro, legacyCustno: "C1", legacyCarno: "V1",
    rawData: { RO_DATE: "20260814", LABOR_DONE: "Service", HOURS: "1.5", LABORRATE: "100" },
    ...overrides,
  };
}

function project(overrides = {}) {
  return projectFinalCutoverOpenOrders({
    partRows: [part()], laborRows: [labor()], customers: [customer], vehicles: [vehicle],
    finalizedInvoices: [], survivingRepairOrders: [], shopSettings: settings,
    currentNextRepairOrderNumber: 21000, ...overrides,
  });
}

const header = (ro, vnotes, recomend) => ({ legacyRoNo: ro, rawData: { RO_NO: ro, VNOTES: vnotes, RECOMEND: recomend } });

function headerDbfFixture({ ro, vnotes, recomend }) {
  const descriptors = [{ name: "RO_NO", type: "N", length: 6 }, { name: "VNOTES", type: "M", length: 4 }, { name: "RECOMEND", type: "M", length: 4 }];
  const headerLength = 32 + descriptors.length * 32 + 1;
  const recordLength = 1 + descriptors.reduce((sum, field) => sum + field.length, 0);
  const dbf = Buffer.alloc(headerLength + recordLength);
  dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(headerLength, 8); dbf.writeUInt16LE(recordLength, 10);
  let descriptorOffset = 32;
  for (const field of descriptors) {
    dbf.write(field.name, descriptorOffset, "ascii"); dbf[descriptorOffset + 11] = field.type.charCodeAt(0); dbf[descriptorOffset + 16] = field.length; descriptorOffset += 32;
  }
  dbf[descriptorOffset] = 0x0d; dbf[headerLength] = 0x20; dbf.write(ro.padStart(6), headerLength + 1, "ascii"); dbf.writeUInt32LE(1, headerLength + 7); dbf.writeUInt32LE(3, headerLength + 11);
  const fpt = Buffer.alloc(320); fpt.writeUInt16BE(64, 6);
  for (const [pointer, value] of [[1, vnotes], [3, recomend]]) {
    const encoded = Buffer.from(value, "latin1"); const offset = pointer * 64; fpt.writeUInt32BE(1, offset); fpt.writeUInt32BE(encoded.length, offset + 4); encoded.copy(fpt, offset + 8);
  }
  return { dbf, fpt };
}

test("final-cutover projection operationalizes active Windows work with exact identity and native snapshots", () => {
  const result = project();
  assert.deepEqual(result.fatalIssues, []);
  assert.equal(result.orders.length, 1);
  const order = result.orders[0];
  assert.equal(order.legacySourceTable, null);
  assert.equal(order.legacyRoNo, "22000");
  assert.equal(order.repairOrderNumber, 22000);
  assert.equal(order.status, "open");
  assert.equal(order.openedAt.toISOString(), "2026-08-14T00:00:00.000Z");
  assert.equal(order.odometer, 48220);
  assert.equal(order.parts[0].partNumber, "OF-1");
  assert.equal(order.parts[0].quantity, 2);
  assert.equal(order.parts[0].unitPrice, 10.1);
  assert.equal(order.parts[0].vendorNameSnapshot, "Vendor A");
  assert.equal(order.labor[0].hours, 1.5);
  assert.equal(order.labor[0].hourlyRate, 100);
  assert.equal(order.labor[0].complimentary, false);
  assert.equal(order.shopSuppliesAmount.toFixed(2), "12.00");
  assert.equal(order.taxTotal.toFixed(2), "1.93");
  assert.equal(order.estimatedTotal.toFixed(2), "184.13");
  assert.equal(result.nextRepairOrderNumber, 22001);
});

test("final-cutover operational Repair Orders use the shared capped-charge estimate rule", () => {
  const result = project({
    partRows: [part("21759", { rawData: { ...part().rawData, RO_NO: "21759", QTY: "1", PRICE: "352" } })],
    laborRows: [labor("21759", { rawData: { ...labor().rawData, RO_NO: "21759", HOURS: "1", LABORRATE: "585" } })],
    shopSettings: { ...settings, shopSuppliesCap: "20" },
  });
  assert.equal(result.orders[0].shopSuppliesAmount.toFixed(2), "20.00");
  assert.equal(result.orders[0].taxTotal.toFixed(2), "23.93");
  assert.equal(result.orders[0].estimatedTotal.toFixed(2), "980.93");
});

test("final-cutover maps exact Windows header concerns and recommendations without changing operations", () => {
  const multiline = "FIRST LINE\r\nSECOND LINE";
  const result = project({ headerRows: [header("22000", "  CUSTOMER CONCERN  ", `  ${multiline}  `)] });
  const order = result.orders[0];
  assert.equal(order.customerComplaint, "CUSTOMER CONCERN");
  assert.equal(order.recommendation, multiline);
  assert.equal(order.partsTotal.toFixed(2), "20.20");
  assert.equal(order.laborTotal.toFixed(2), "150.00");
  assert.equal(order.odometer, 48220);
  assert.equal(order.estimatedTotal.toFixed(2), "184.13");
});

test("ordtemps DBF/FPT reader decodes and preserves multiline memo text", () => {
  const fixture = headerDbfFixture({ ro: "21759", vnotes: "CONCERN", recomend: "LINE ONE\r\nLINE TWO" });
  assert.deepEqual(readLegacyOpenOrderHeaders(fixture.dbf, fixture.fpt), [{ legacyRoNo: "21759", rawData: { RO_NO: "21759", VNOTES: "CONCERN", RECOMEND: "LINE ONE\r\nLINE TWO" } }]);
});

test("blank Windows header concern and recommendation map to null", () => {
  const order = project({ headerRows: [header("22000", " \r\n ", "")] }).orders[0];
  assert.equal(order.customerComplaint, null);
  assert.equal(order.recommendation, null);
});

test("reviewed RO 21756 and RO 21759 header fixtures preserve exact snapshot behavior", () => {
  const concerns21756 = "ENGINE SHAKES AT IDLE AND WHILE DRIVING CHECK ENGINE LIGHT FLASHES";
  const recommendation21756 = "REPLACE SPARK PLUGS AND IGNTION COILS QUOTED $985";
  const concerns21759 = "TOW IN CUSTOMER NOTICED FLUID LEAK AT RIGHT FRONT WHEEL THINKS ITS BRAKE FLUID";
  const recommendation21759 = "THERMOSTAT AND WATER PUMP NEED REPLACEMENT- LEAK\r\nMINOR OIL LEAKS PRESENT CUSTOMER WAS ADVISED TO SEE DEALER LAST VISIT \r\nON ROAD TEST NOTICED MID SHIFT BEARING ON REAR DRIVE SHAFT WAS NOISY";
  const projected21756 = project({ partRows: [part("21756")], laborRows: [labor("21756")], headerRows: [header("21756", concerns21756, recommendation21756)] }).orders[0];
  assert.equal(projected21756.customerComplaint, concerns21756);
  assert.equal(projected21756.recommendation, recommendation21756);
  const projected21759 = project({ partRows: [part("21759", { rawData: { ...part().rawData, RO_DATE: "20260815", QTY: "1", PRICE: "352" } })], laborRows: [labor("21759", { rawData: { ...labor().rawData, RO_DATE: "20260815", HOURS: "1", LABORRATE: "585" } })], headerRows: [header("21759", concerns21759, recommendation21759)], shopSettings: { ...settings, shopSuppliesCap: "20" } }).orders[0];
  assert.equal(projected21759.customerComplaint, concerns21759);
  assert.equal(projected21759.recommendation, recommendation21759);
  assert.equal(projected21759.estimatedTotal.toFixed(2), "980.93");
});

test("next Repair Order number advances only upward", () => {
  assert.equal(project({ currentNextRepairOrderNumber: 23000 }).nextRepairOrderNumber, 23000);
  assert.equal(project({ currentNextRepairOrderNumber: 22000 }).nextRepairOrderNumber, 22001);
});

test("writer locks and re-reads the Shop before advancing the counter", async () => {
  const source = await read("scripts/transform-open-orders.mjs");
  assert.match(source, /requiredFiles: \["ordtemps\.DBF", "ordtemps\.FPT"\]/);
  assert.match(source, /loadLegacyOpenOrderHeaders\(headerSource\)/);
  assert.match(source, /survivingRepairOrders, headerRows, shopSettings/);
  assert.match(source, /SELECT id FROM shops[\s\S]*FOR UPDATE/);
  assert.match(source, /Math\.max\(currentShop\.nextRepairOrderNumber, projection\.nextRepairOrderNumber\)/);
});

test("invalid, duplicate, destination-conflicting, and epoch active RO identities block", () => {
  assert.ok(project({ partRows: [part("bad")], laborRows: [] }).fatalIssues.some((issue) => issue.code === "invalid-active-ro-number"));
  assert.ok(project({ partRows: [part("022000"), part("22000", { legacyRowKey: "orders:22000:2" })], laborRows: [] }).fatalIssues.some((issue) => issue.code === "duplicate-projected-repair-order-number"));
  assert.ok(project({ survivingRepairOrders: [{ repairOrderNumber: 22000 }] }).fatalIssues.some((issue) => issue.code === "destination-repair-order-number-collision"));
  assert.ok(project({ partRows: [part("22000", { rawData: { ...part().rawData, RO_DATE: "19700101" } })], laborRows: [] }).fatalIssues.some((issue) => issue.code === "invalid-active-ro-date"));
  assert.ok(project({ partRows: [part("22000", { rawData: { ...part().rawData, RO_DATE: null } })], laborRows: [] }).fatalIssues.some((issue) => issue.code === "invalid-active-ro-date"));
  assert.ok(project({ partRows: [part("22000", { rawData: { ...part().rawData, RO_DATE: "20260230" } })], laborRows: [] }).fatalIssues.some((issue) => issue.code === "invalid-active-ro-date"));
});

test("customer and Vehicle identity must resolve exactly", () => {
  assert.ok(project({ customers: [] }).fatalIssues.some((issue) => issue.code === "unresolved-active-ro-customer"));
  assert.ok(project({ vehicles: [] }).fatalIssues.some((issue) => issue.code === "unresolved-active-ro-vehicle"));
  assert.ok(project({ vehicles: [{ ...vehicle, customerId: "another-customer" }] }).fatalIssues.some((issue) => issue.code === "active-ro-customer-vehicle-mismatch"));
  assert.ok(project({ partRows: [part(), { ...part(), legacyRowKey: "orders:22000:2", legacyCustno: "C2" }], laborRows: [] }).fatalIssues.some((issue) => issue.code === "ambiguous-active-ro-customer"));
});

test("known RO 11159 shape is an explicit finalized-history blocker and is never skipped or renumbered", () => {
  const source = part("11159");
  const result = project({
    partRows: [source], laborRows: [],
    finalizedInvoices: [{ legacyRoNo: "11159", legacyCustno: "C1", legacyCarno: "V1" }],
  });
  assert.equal(result.orders.length, 0);
  assert.ok(result.fatalIssues.some((issue) => issue.code === "finalized-invoice-ro-number-collision" && issue.legacyRoNo === "11159"));
  assert.ok(result.fatalIssues.some((issue) => issue.code === "finalized-invoice-identity-collision" && issue.legacyRoNo === "11159"));
});

test("missing mileage remains absent", () => {
  const result = project({ partRows: [part("22000", { rawData: { ...part().rawData, ODOMETER: null } })], laborRows: [] });
  assert.equal(result.orders[0].odometer, null);
});

test("generic open-order transform remains legacy while confirmed cutover explicitly requests operational mode", async () => {
  const [transform, cutover] = await Promise.all([read("scripts/transform-open-orders.mjs"), read("scripts/legacy-cutover.mjs")]);
  assert.match(transform, /legacySourceTable: "orders\/LABORorder"/);
  assert.match(transform, /process\.argv\.includes\(FINAL_CUTOVER_OPEN_ORDER_FLAG\)/);
  assert.match(cutover, /transform-open-orders\.mjs", \[[\s\S]*FINAL_CUTOVER_OPEN_ORDER_FLAG,[\s\S]*FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION_FLAG, FINAL_CUTOVER_OPEN_ORDER_CONFIRMATION/);
  assert.match(transform, /Final-cutover operationalization requires its explicit confirmation token/);
  assert.match(cutover, /completionActionForMode\(lifecycle\.mode\)/);
  assert.match(cutover, /assertCutoverLifecycleAllowed/);
});

test("operational routes accept source-null cutoff ROs and Invoice creation stays native", async () => {
  const [predicate, dashboard, openOrders, search, detail, parts, labor, complimentary, finalize, deletion, history, reports] = await Promise.all([
    read("src/lib/repair-order-lifecycle.ts"), read("src/lib/data/dashboard.ts"),
    read("src/lib/data/open-orders.ts"), read("src/app/(app)/search/page.tsx"),
    read("src/app/(app)/repair-orders/[id]/page.tsx"), read("src/app/(app)/repair-orders/part-actions.ts"),
    read("src/app/(app)/repair-orders/labor-actions.ts"), read("src/app/(app)/repair-orders/complimentary-service-actions.ts"),
    read("src/app/(app)/repair-orders/finalize-actions.ts"), read("src/app/(app)/repair-orders/delete-actions.ts"),
    read("src/lib/data/repair-order-history.ts"),
    read("src/lib/reportable-sales.ts"),
  ]);
  for (const source of [predicate, parts, labor, complimentary, finalize]) assert.match(source, /legacySourceTable: null/);
  assert.match(dashboard, /operationalRepairOrderWhere\(shopId\)/);
  assert.match(openOrders, /operationalRepairOrderWhere\(membership\.shopId\)/);
  assert.match(search, /order\.legacySourceTable \? `\/open-orders\/\$\{order\.id\}` : `\/repair-orders\/\$\{order\.id\}`/);
  assert.match(detail, /`\/repair-orders\/\$\{order\.id\}\/print`/);
  assert.match(finalize, /status: "open"/);
  assert.match(finalize, /repairOrderId: order\.id/);
  assert.doesNotMatch(finalize, /legacySourceTable:\s*order\./);
  assert.match(deletion, /requirePermission\("delete_draft_repair_order"\)/);
  assert.match(deletion, /source: order\.legacyRoNo \? "final_cutover" : "web"/);
  assert.match(history, /invoices: \{ none: \{\} \}/);
  assert.match(reports, /legacySourceTable: null[\s\S]*status: "closed"[\s\S]*closedAt/);
});

test("test-created RO verification never selects an operationalized cutoff RO", async () => {
  const sources = await Promise.all([
    read("scripts/verify-web-repair-orders.mjs"),
    read("scripts/verify-web-repair-order-parts.mjs"),
    read("scripts/verify-web-repair-order-labor.mjs"),
    read("scripts/verify-repair-order-finalization.mjs"),
  ]);
  for (const source of sources) assert.match(source, /legacySourceTable: null, legacyRoNo: null/);
});
