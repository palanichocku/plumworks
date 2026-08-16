import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXCLUDE_STALE_ACTIVE_RO,
  finalCutoverAdjudicationArguments,
  FINAL_CUTOVER_ADJUDICATION_TYPE,
  finalizedCollisionEvidence,
  RELEVANT_SOURCE_FILES,
  STALE_DUPLICATE_CLASSIFICATION,
  validateFinalCutoverAdjudication,
} from "./lib/legacy-final-cutover-adjudication.mjs";
import { keyedOpenOrderRows } from "./lib/legacy-open-order-source.mjs";
import { projectFinalCutoverOpenOrders } from "./lib/legacy-open-order-projection.mjs";
import { verifyFreshLegacyCutover } from "./lib/legacy-cutover-acceptance.mjs";

const shopId = "10000000-0000-4000-8000-000000000001";
const source = {
  fingerprint: "a".repeat(64),
  fingerprints: Object.fromEntries(RELEVANT_SOURCE_FILES.map((file, index) => [file, String(index + 1).repeat(64)])),
};
const snapshot = {
  manifest: { snapshotDate: "2026-07-11", zipSha256: "b".repeat(64) },
  manifestFingerprint: "c".repeat(64),
};
const staleLabor = keyedOpenOrderRows(Array.from({ length: 20 }, (_, index) => ({
  RO_NO: "11159", CUSTNO: index === 19 ? "0" : "C1", CARNO: index === 19 ? "V1" : null,
  RO_DATE: null, LABOR_DONE: `Stale line ${index + 1}`, HOURS: "0", LABORRATE: "60", LABOR: "0",
})), "rawLegacyOrderLabor").map((row) => ({ ...row, legacyRoNo: "11159", legacyCustno: row.rawData.CUSTNO, legacyCarno: row.rawData.CARNO }));
const activeParts = keyedOpenOrderRows([{ RO_NO: "21712", CUSTNO: "C2", CARNO: "V2", RO_DATE: "20260711", DESC: "Rotor", QTY: "1", PRICE: "0" }], "rawLegacyOrderPart")
  .map((row) => ({ ...row, legacyRoNo: "21712", legacyCustno: "C2", legacyCarno: "V2" }));
const finalizedRows = {
  "FINAL.DBF": [{ legacyRoNo: "11159", rawData: { RO_NO: "11159", CUSTNO: "C1", CARNO: "V1", DATE_SOLD: "20121213", TOTAL: "125.56" } }],
  "laborfinal.DBF": [{ legacyRoNo: "11159", rawData: { RO_NO: "11159", CUSTNO: "C1", CARNO: "V1", DATE_SOLD: "20121213", LABOR_DONE: "Completed service" } }],
  "ar.DBF": [{ legacyRoNo: "11159", rawData: { RO_NO: "11159", CUSTNO: "C1", DATE_SOLD: "20121213", TOTAL: "125.56" } }],
};

function manifest() {
  return {
    formatVersion: 1,
    manifestType: FINAL_CUTOVER_ADJUDICATION_TYPE,
    shopId,
    snapshot: {
      snapshotDate: snapshot.manifest.snapshotDate,
      zipSha256: snapshot.manifest.zipSha256,
      snapshotManifestSha256: snapshot.manifestFingerprint,
      combinedSourceFingerprint: source.fingerprint,
      sourceHashes: { ...source.fingerprints },
    },
    activeOpenOrderDecisions: [{
      decision: EXCLUDE_STALE_ACTIVE_RO,
      roNumber: 11159,
      expectedTables: { "orders.DBF": 0, "LABORorder.DBF": 20 },
      expectedRecordCount: 20,
      expectedStableRowKeys: staleLabor.map((row) => row.legacyRowKey),
      expectedFinalizedCollision: finalizedCollisionEvidence("11159", finalizedRows),
      classification: STALE_DUPLICATE_CLASSIFICATION,
      reason: "Reviewed malformed stale labor residue already represented by finalized history.",
      reviewedBy: "reviewer@example.test",
      reviewedAt: "2026-08-14T12:00:00.000Z",
      approved: true,
    }],
  };
}

function validate(overrides = {}) {
  return validateFinalCutoverAdjudication({
    manifest: manifest(), manifestFingerprint: "d".repeat(64), shopId, source, snapshot,
    openRows: { partRows: activeParts, laborRows: staleLabor }, finalizedRows, ...overrides,
  });
}

const settings = {
  defaultTaxRate: "0.06", partsTaxable: true, laborTaxable: false,
  shopSuppliesEnabled: true, shopSuppliesRate: "0.08", shopSuppliesCap: "25", shopSuppliesTaxable: true,
};

test("adjudication requires a snapshot manifest while recovery may supply the snapshot alone", () => {
  assert.deepEqual(finalCutoverAdjudicationArguments([]), { manifestPath: null, snapshotManifestPath: null });
  assert.deepEqual(finalCutoverAdjudicationArguments(["--final-cutover-adjudication", "/safe/a.json", "--snapshot-manifest", "/safe/s.json"]), {
    manifestPath: "/safe/a.json", snapshotManifestPath: "/safe/s.json",
  });
  assert.throws(() => finalCutoverAdjudicationArguments(["--final-cutover-adjudication", "/safe/a.json"]), /requires --snapshot-manifest/);
  assert.deepEqual(finalCutoverAdjudicationArguments(["--snapshot-manifest", "/safe/s.json"]), { manifestPath: null, snapshotManifestPath: "/safe/s.json" });
});

function project(adjudicationPlan = null) {
  return projectFinalCutoverOpenOrders({
    partRows: activeParts,
    laborRows: staleLabor,
    customers: [{ id: "customer-1", legacyCustno: "C1" }, { id: "customer-2", legacyCustno: "C2" }],
    vehicles: [{ id: "vehicle-1", legacyCarno: "V1", customerId: "customer-1" }, { id: "vehicle-2", legacyCarno: "V2", customerId: "customer-2" }],
    finalizedInvoices: [{ legacyRoNo: "11159", legacyCustno: "C1", legacyCarno: "V1" }],
    survivingRepairOrders: [], shopSettings: settings, currentNextRepairOrderNumber: 21000, adjudicationPlan,
  });
}

test("RO 11159 blocks without adjudication", () => {
  const result = project();
  assert.ok(result.fatalIssues.some((issue) => issue.code === "ambiguous-active-ro-customer"));
  assert.ok(result.fatalIssues.some((issue) => issue.code === "invalid-active-ro-date"));
  assert.ok(result.fatalIssues.some((issue) => issue.code === "finalized-invoice-ro-number-collision"));
});

test("exact approved adjudication excludes only 20 reviewed rows and keeps RO 21712 operational", () => {
  const plan = validate();
  assert.deepEqual(plan.fatalIssues, []);
  assert.equal(plan.excludedRowKeys.size, 20);
  const result = project(plan);
  assert.deepEqual(result.fatalIssues, []);
  assert.deepEqual(result.orders.map((row) => row.legacyRoNo), ["21712"]);
  assert.equal(result.reviewedExclusions[0].legacyRoNo, "11159");
  assert.equal(result.reviewedExclusions[0].sourceRows, 20);
  assert.equal(finalizedRows["ar.DBF"].length, 1);
});

for (const [name, mutate, code] of [
  ["wrong ZIP hash", (value) => { value.snapshot.zipSha256 = "e".repeat(64); }, "adjudication-zip-hash-mismatch"],
  ["wrong snapshot manifest", (value) => { value.snapshot.snapshotManifestSha256 = "e".repeat(64); }, "adjudication-snapshot-manifest-mismatch"],
  ["wrong combined fingerprint", (value) => { value.snapshot.combinedSourceFingerprint = "e".repeat(64); }, "adjudication-source-fingerprint-mismatch"],
  ["wrong DBF hash", (value) => { value.snapshot.sourceHashes["LABORorder.DBF"] = "e".repeat(64); }, "adjudication-source-file-hash-mismatch"],
  ["missing stable row key", (value) => { value.activeOpenOrderDecisions[0].expectedStableRowKeys.pop(); }, "adjudication-source-row-key-mismatch"],
  ["wrong finalized collision", (value) => { value.activeOpenOrderDecisions[0].expectedFinalizedCollision.sourceRows["ar.DBF"] = []; }, "adjudication-finalized-collision-mismatch"],
  ["wrong shop", (value) => { value.shopId = "20000000-0000-4000-8000-000000000002"; }, "adjudication-shop-mismatch"],
  ["unapproved decision", (value) => { value.activeOpenOrderDecisions[0].approved = false; }, "unapproved-active-ro-decision"],
  ["different RO", (value) => { value.activeOpenOrderDecisions[0].roNumber = 21712; }, "adjudication-source-row-count-mismatch"],
  ["future ZIP", (value) => { value.snapshot.zipSha256 = "f".repeat(64); }, "adjudication-zip-hash-mismatch"],
]) test(`${name} rejects adjudication`, () => {
  const changed = manifest();
  mutate(changed);
  const result = validate({ manifest: changed });
  assert.ok(result.fatalIssues.some((issue) => issue.code === code));
  assert.equal(result.excludedRowKeys.size, 0);
});

test("extra, changed, or newly deleted source rows invalidate reviewed row identity", () => {
  const extra = { ...staleLabor[0], legacyRowKey: `${staleLabor[0].legacyRowKey}:extra` };
  for (const laborRows of [
    [...staleLabor, extra],
    [{ ...staleLabor[0], legacyRowKey: "rawLegacyOrderLabor:changed:1" }, ...staleLabor.slice(1)],
    staleLabor.slice(1),
  ]) {
    const result = validate({ openRows: { partRows: activeParts, laborRows } });
    assert.ok(result.fatalIssues.some((issue) => ["adjudication-source-row-count-mismatch", "adjudication-source-row-key-mismatch"].includes(issue.code)));
    assert.equal(result.excludedRowKeys.size, 0);
  }
});

test("acceptance reports reviewed exclusions explicitly instead of a skipped count", () => {
  const projection = project(validate());
  const acceptance = verifyFreshLegacyCutover({
    shopId, rawAr: [], rawFinal: [], openPartRows: activeParts, openLaborRows: staleLabor,
    invoiceProjection: { invoices: [], parts: [], labor: [] }, customerIds: new Set(["C1", "C2"]),
    vehicleIds: new Set(["V1", "V2"]), finalCutoverProjection: projection,
  });
  assert.equal(acceptance.operational.reviewedExclusionCount, 1);
  assert.equal(acceptance.operational.reviewedExcludedSourceRows, 20);
  assert.equal(acceptance.operational.reviewedExclusions[0].decision, EXCLUDE_STALE_ACTIVE_RO);
});

test("generic import has no adjudication or heuristic skip path", async () => {
  const [transform, importer] = await Promise.all([
    readFile(new URL("./transform-open-orders.mjs", import.meta.url), "utf8"),
    readFile(new URL("./import-open-orders.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(transform, /legacySourceTable: "orders\/LABORorder"/);
  assert.match(transform, /adjudication is valid only in explicit final-cutover operational mode/);
  assert.doesNotMatch(importer, /ignore old|already invoiced|zero-dollar/i);
});
