import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildParallelCutoverArguments, buildParallelPreflightArguments, classifyActiveOrderCandidates, compareActiveOrderBaseline,
  compareRecoveryBaseline, parseParallelRefreshArguments, transitionRunState, validateParallelExecutionSafety,
  validateExistingBaselineAdoption,
} from "./lib/legacy-parallel-refresh.mjs";

test("existing baseline adoption requires explicit provenance inputs", () => {
  const parsed = parseParallelRefreshArguments("adopt-baseline", ["--run", "/baseline", "--cutover-report", "/report", "--cutover-backup", "/backup", "--source-cutover-commit", "abc", "--post-cutover-correction-artifact", "/correction", "--post-cutover-correction-commit", "def"]);
  assert.equal(parsed.command, "adopt-baseline");
  assert.equal(parsed.run, "/baseline");
  assert.throws(() => parseParallelRefreshArguments("adopt-baseline", ["--run", "/baseline"]), /--cutover-report/);
});

test("historical adoption validates immutable evidence and platform identity while recording later business drift", () => {
  const config = { expectedDatabaseFingerprint: "db", shopId: "shop", shopName: "CAR DOC LLC" };
  const expected = { zipSha256: "zip", sourceFingerprint: "source", correctionSha256: "correction", counts: { customers: 3668, vehicles: 5239, invoices: 11727, accountsReceivable: 11727, payments: 11887, repairOrders: 2 }, controlTotals: { january2026: "13608.61", h1_2026: "130599.15", year2025: "273292.61" } };
  const fixture = { config, expected, manifest: { snapshotDate: "2026-08-29", zipSha256: "zip" }, sourceFingerprint: "source", reportPath: "/report", backupPath: "/backup", correctionSha256: "correction",
    report: { status: "PASS WITH WARNINGS", mode: "cutover", source: { path: "/source", expectedCleanCounts: { customers: 3668, vehicles: 5239, invoices: 11727, accounts_receivable: 11727, payments: 11887 } }, verification: { verifiedAfterReload: 1, authoritativeBackupVerified: 1 }, criticalIssues: [], lifecycle: { windowsAuthorityThrough: "2026-08-29" } },
    production: { databaseFingerprint: "db", shop: { id: "shop", name: "CAR DOC LLC" }, migrations: { pending: 0, failed: 0 }, counts: expected.counts, operationalRepairOrders: [{ repairOrderNumber: 21773 }, { repairOrderNumber: 21775 }], controlTotals: expected.controlTotals, unexpectedNativeBusinessRows: 0 } };
  assert.equal(validateExistingBaselineAdoption(fixture).verified, true);
  const drifted = { ...fixture, production: { ...fixture.production, counts: { customers: 3675, vehicles: 5246, invoices: 11740, accountsReceivable: 11740, payments: 11896, repairOrders: 17 }, operationalRepairOrders: [{ repairOrderNumber: 21773 }, { repairOrderNumber: 21775 }, { repairOrderNumber: 21798 }, { repairOrderNumber: 21799 }], unexpectedNativeBusinessRows: 42 } };
  const adopted = validateExistingBaselineAdoption(drifted);
  assert.equal(adopted.verified, true);
  assert.equal(adopted.historicalBaseline, true);
  assert.equal(adopted.currentProductionMatchesHistoricalCounts, false);
  assert.deepEqual(adopted.countDrift.customers, { historical: 3668, current: 3675, delta: 7 });
  assert.deepEqual(adopted.countDrift.repairOrders, { historical: 2, current: 17, delta: 15 });
  assert.throws(() => validateExistingBaselineAdoption({ ...fixture, production: { ...fixture.production, databaseFingerprint: "wrong" } }), /fingerprint/);
  assert.throws(() => validateExistingBaselineAdoption({ ...fixture, production: { ...fixture.production, shop: { id: "wrong", name: "CAR DOC LLC" } } }), /Shop/);
  assert.throws(() => validateExistingBaselineAdoption({ ...fixture, report: { ...fixture.report, status: "FAIL" } }), /cutover report/);
  assert.throws(() => validateExistingBaselineAdoption({ ...fixture, manifest: { ...fixture.manifest, zipSha256: "changed" } }), /ZIP/);
  assert.throws(() => validateExistingBaselineAdoption({ ...fixture, sourceFingerprint: "changed" }), /source fingerprint/);
});

const candidate = (id) => ({ candidateId: id });
const proposal = { candidateSetSha256: "a", vehicleCandidateSetSha256: "b", candidates: [candidate("c1")], vehicleCandidates: [candidate("v1")] };
const approval = { candidateSetSha256: "a", vehicleCandidateSetSha256: "b", decisions: [{ candidateId: "c1", decisionType: "x" }], vehicleDecisions: [{ candidateId: "v1", action: "y" }] };

test("prepare requires a ZIP, date, and accepts explicit deployment scope", () => {
  assert.deepEqual(parseParallelRefreshArguments("prepare", ["--zip", "/tmp/a.zip", "--windows-authority-through", "2026-09-05", "--shop-id", "shop"]), {
    command: "prepare", config: null, runRoot: null, zip: "/tmp/a.zip", windowsAuthorityThrough: "2026-09-05", shopId: "shop", baselineRun: null, baselineApproval: null, baselineAdjudication: null, baselineResolution: null,
  });
  assert.throws(() => parseParallelRefreshArguments("prepare", ["--zip", "/tmp/a.zip", "--windows-authority-through", "bad"]), /valid YYYY-MM-DD/);
  assert.throws(() => parseParallelRefreshArguments("prepare", ["--zip", "/tmp/a.zip", "--windows-authority-through", "2026-09-05", "--confirm", "x"]), /Unknown/);
});

test("malformed ZIP, missing DBF, and changed schema remain delegated fail-closed gates", async () => {
  const source = await readFile("scripts/lib/legacy-parallel-refresh.mjs", "utf8");
  assert.match(source, /runSnapshotIntake/);
  assert.match(source, /requiredFiles: CONSOLIDATED_SOURCE_FILES/);
  assert.match(source, /Legacy DBF schema differs from the accepted production format/);
});

test("same recovery candidates expose prior decisions for human reuse review without approving them", () => {
  const result = compareRecoveryBaseline({ proposal, baselineApproval: approval });
  assert.equal(result.customerCandidateSetEquivalent, true);
  assert.equal(result.vehicleCandidateSetEquivalent, true);
  assert.equal(result.customers.unchangedCandidates, 1);
  assert.equal(result.vehicles.unchangedCandidates, 1);
  assert.equal(result.customerDecisionsAvailableForReuseReview, true);
});

test("zero-dollar unresolved Customer candidates participate in decision reuse comparison", () => {
  const unresolved = candidate("c0");
  const result = compareRecoveryBaseline({
    proposal: { ...proposal, candidates: [], unresolvedCandidates: [unresolved] },
    baselineApproval: { ...approval, decisions: [{ candidateId: "c0", decisionType: "keep-exact-zero-dollar-reference-unresolved" }] },
  });
  assert.deepEqual(result.customers, { current: 1, unchangedCandidates: 1, newCandidates: 0, removedCandidates: 0 });
  assert.deepEqual(result.customerDecisionMappings, { identical: 1, changed: 0, missingOrNew: 0 });
});

test("new and removed Customer/Vehicle candidates are reported", () => {
  const result = compareRecoveryBaseline({ proposal: { ...proposal, candidates: [candidate("c2")], vehicleCandidates: [candidate("v1"), candidate("v2")] }, baselineApproval: approval });
  assert.deepEqual(result.customers, { current: 1, unchangedCandidates: 0, newCandidates: 1, removedCandidates: 1 });
  assert.deepEqual(result.vehicles, { current: 2, unchangedCandidates: 1, newCandidates: 1, removedCandidates: 0 });
  assert.equal(result.customerDecisionsAvailableForReuseReview, false);
});

test("same candidates with changed candidate-set evidence require review", () => {
  const result = compareRecoveryBaseline({ proposal: { ...proposal, candidateSetSha256: "changed" }, baselineApproval: approval });
  assert.equal(result.customerCandidateSetEquivalent, false);
  assert.equal(result.customers.unchangedCandidates, 1);
});

const row = (ro, table, fields = {}) => ({ legacyRoNo: ro, legacyRowKey: `${table}:${ro}`, rawData: { RO_NO: ro, ...fields } });
test("active labor without a header remains an unresolved review candidate", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [row("9", "labor")], finalizedRows: { "FINAL.DBF": [], "laborfinal.DBF": [], "ar.DBF": [] } });
  assert.equal(result[0].classification, "UNRESOLVED_REVIEW_REQUIRED");
});

test("finalized active labor is classified as stale evidence, never auto-approved", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [row("9", "labor")], finalizedRows: { "FINAL.DBF": [{ rawData: { RO_NO: "9" } }], "laborfinal.DBF": [], "ar.DBF": [] } });
  assert.equal(result[0].classification, "FINALIZED_STALE_CANDIDATE");
});

test("complete genuine active evidence remains explicitly human-review required", () => {
  const result = classifyActiveOrderCandidates({ partRows: [row("10", "part", { CUSTNO: "C", CARNO: "V", RO_DATE: "20260905" })], laborRows: [], finalizedRows: { "FINAL.DBF": [], "laborfinal.DBF": [], "ar.DBF": [] } });
  assert.equal(result[0].classification, "LIKELY_ACTIVE_REVIEW_REQUIRED");
});

const finalized = { "FINAL.DBF": [], "laborfinal.DBF": [], "ar.DBF": [], "finalsold.DBF": [] };
const header = (ro = "21775", fields = {}) => ({ legacyRoNo: ro, legacyRowKey: `header:${ro}`, legacyCustno: "C", legacyCarno: "V", rawData: { RO_NO: ro, CUSTNO: "C", CARNO: "V", RO_DATE: "20260829", ODOMETER: "91705", TECH: "SUBBU", ...fields } });
const identity = { customers: [{ deleted: false, rawData: { CUSTNO: "C" } }], vehicles: [{ deleted: false, rawData: { CUSTNO: "C", CARNO: "V" } }] };

test("ordtemps-only zero-line open RO is surfaced for explicit human review", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [], headerRows: [header()], ...identity, finalizedRows: finalized });
  assert.equal(result[0].classification, "ORDTEMPS_ONLY_REVIEW_REQUIRED");
  assert.equal(result[0].ordtempsOnly, true); assert.equal(result[0].partRows, 0); assert.equal(result[0].laborRows, 0);
});

test("ordtemps finalized collision is stale evidence and never an active recommendation", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [], headerRows: [header()], ...identity, finalizedRows: { ...finalized, "finalsold.DBF": [{ rawData: { RO_NO: "21775" } }] } });
  assert.equal(result[0].classification, "FINALIZED_STALE_CANDIDATE");
});

test("ordtemps candidate deduplicates with evidence already surfaced elsewhere", () => {
  const result = classifyActiveOrderCandidates({ partRows: [row("21775", "part", { CUSTNO: "C", CARNO: "V", RO_DATE: "20260829" })], laborRows: [], headerRows: [header()], ...identity, finalizedRows: finalized });
  assert.equal(result.length, 1); assert.equal(result[0].ordtempsOnly, false); assert.equal(result[0].classification, "LIKELY_ACTIVE_REVIEW_REQUIRED");
});

test("ordtemps missing destination Customer or Vehicle fails closed", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [], headerRows: [header()], customers: [], vehicles: [{ deleted: false, rawData: { CUSTNO: "C", CARNO: "V" } }], finalizedRows: finalized });
  assert.equal(result[0].classification, "UNRESOLVED_REVIEW_REQUIRED");
});

test("ambiguous ordtemps structural identity fails closed", () => {
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [], headerRows: [header(), header("21775", { CUSTNO: "OTHER" })], ...identity, finalizedRows: finalized });
  assert.equal(result[0].classification, "UNRESOLVED_REVIEW_REQUIRED");
});

test("deleted structural rows are retained as compact hashed evidence", () => {
  const structuralPartRows = [{ deleted: true, stableRowKey: "deleted:part", evidenceSha256: "a", rawData: { RO_NO: "21775" } }];
  const result = classifyActiveOrderCandidates({ partRows: [], laborRows: [], headerRows: [header()], structuralPartRows, ...identity, finalizedRows: finalized });
  assert.deepEqual(result[0].structuralEvidence, [{ sourceTable: "orders.DBF", stableRowKey: "deleted:part", evidenceSha256: "a", deleted: true }]);
});

test("known active-RO edge cases 11159, 21773, and 21775 remain explicitly classified", () => {
  const customers = [
    { deleted: false, rawData: { CUSTNO: "87612367" } },
    { deleted: false, rawData: { CUSTNO: "87612072" } },
  ];
  const vehicles = [
    { deleted: false, rawData: { CUSTNO: "87612367", CARNO: "87612368" } },
    { deleted: false, rawData: { CUSTNO: "87612072", CARNO: "87612073" } },
  ];
  const labor21773 = row("21773", "labor", { CUSTNO: "87612367", CARNO: "87612368", RO_DATE: "20260828", ODOMETER: "178016", DESCRIPTION: "Substantive active labor" });
  const result = classifyActiveOrderCandidates({
    partRows: [],
    laborRows: [row("11159", "labor", { CUSTNO: "OLD", CARNO: "OLDV", RO_DATE: "20121213" }), labor21773],
    headerRows: [{ ...header("21775", { CUSTNO: "87612072", CARNO: "87612073" }), legacyCustno: "87612072", legacyCarno: "87612073" }],
    structuralPartRows: [{ deleted: true, stableRowKey: "orders:21773:deleted", evidenceSha256: "p", rawData: { RO_NO: "21773" } }],
    structuralLaborRows: [{ deleted: true, stableRowKey: "labor:21773:deleted", evidenceSha256: "l", rawData: { RO_NO: "21773" } }],
    customers,
    vehicles,
    finalizedRows: { ...finalized, "FINAL.DBF": [{ rawData: { RO_NO: "11159", CUSTNO: "OLD", CARNO: "OLDV", DATE_SOLD: "20121213" } }] },
  });
  const known = Object.fromEntries(result.map((candidate) => [candidate.roNumber, candidate]));
  assert.equal(known["11159"].classification, "FINALIZED_STALE_CANDIDATE");
  assert.equal(known["21773"].classification, "LIKELY_ACTIVE_REVIEW_REQUIRED");
  assert.deepEqual({ customer: known["21773"].customerLegacyId, vehicle: known["21773"].vehicleLegacyId, date: known["21773"].sourceDate, mileage: known["21773"].mileage, labor: known["21773"].laborRows, structural: known["21773"].structuralEvidence.length }, { customer: "87612367", vehicle: "87612368", date: "20260828", mileage: "178016", labor: 1, structural: 2 });
  assert.equal(known["21773"].finalizedCollision.sourceRows["FINAL.DBF"].length, 0);
  assert.equal(known["21775"].classification, "ORDTEMPS_ONLY_REVIEW_REQUIRED");
  assert.deepEqual({ customer: known["21775"].customerLegacyId, vehicle: known["21775"].vehicleLegacyId, date: known["21775"].sourceDate, mileage: known["21775"].mileage, parts: known["21775"].partRows, labor: known["21775"].laborRows }, { customer: "87612072", vehicle: "87612073", date: "20260829", mileage: "91705", parts: 0, labor: 0 });
});

test("matching prior stale and active decisions reduce review work without authorizing the new snapshot", () => {
  const candidates = [{ roNumber: "9", stableRowKeys: ["a"] }, { roNumber: "10", stableRowKeys: ["b"] }];
  const result = compareActiveOrderBaseline({ candidates, adjudication: { activeOpenOrderDecisions: [{ roNumber: 9, expectedStableRowKeys: ["a"] }] }, resolution: { decisions: [{ roNumber: 10, sourceRows: [{ stableRowKey: "b" }] }] } });
  assert.deepEqual(result.map((item) => item.priorDecision), ["MATCHING_PRIOR_STALE_EXCLUSION", "MATCHING_PRIOR_ACTIVE_RESOLUTION"]);
});

test("run state is monotonic and cannot skip backward", () => {
  const intake = transitionRunState({ history: [] }, "INTAKE_COMPLETE", "t1");
  const validated = transitionRunState(intake, "SOURCE_VALIDATED", "t2");
  assert.equal(validated.stage, "SOURCE_VALIDATED");
  assert.throws(() => transitionRunState(validated, "INTAKE_COMPLETE"), /non-monotonic/);
});

function executionFixture() {
  return { config: { expectedDatabaseFingerprint: "f", shopId: "s", shopName: "Shop" }, summary: { shopId: "s", resetScopeBaseline: { invoices: 1 } }, shop: { id: "s", name: "Shop" }, databaseFingerprint: "f", migrationStatus: { pending: 0, failed: 0 }, currentCounts: { invoices: 1 } };
}

for (const [label, change, message] of [
  ["production fingerprint mismatch", (v) => { v.databaseFingerprint = "wrong"; }, /fingerprint/],
  ["Shop mismatch", (v) => { v.shop.id = "wrong"; }, /Shop/],
  ["pending migration", (v) => { v.migrationStatus.pending = 1; }, /migration/],
  ["failed migration", (v) => { v.migrationStatus.failed = 1; }, /migration/],
  ["changed reset scope", (v) => { v.currentCounts.invoices = 2; }, /reset scope/],
]) test(`${label} blocks execute`, () => { const value = executionFixture(); change(value); assert.throws(() => validateParallelExecutionSafety(value), message); });

test("exact production identity, migrations, Shop, and reset scope pass", () => assert.equal(validateParallelExecutionSafety(executionFixture()), true));

test("an adopted historical baseline is comparison-only and can never authorize execution", () => {
  const value = executionFixture(); value.summary.historicalBaseline = true;
  assert.throws(() => validateParallelExecutionSafety(value), /comparison-only/);
});

test("preflight is always separate and zero-write; execute retains every destructive safety gate", () => {
  const summary = { sourcePath: "/snapshot/data", shopId: "s", recovery: { proposalPath: "/proposal" }, snapshotManifest: "/manifest", windowsAuthorityThrough: "2026-09-05" };
  const paths = { recoveryApproval: "/approval", staleAdjudication: null, activeResolution: null };
  const preflight = buildParallelPreflightArguments({ summary, paths, reportDirectory: "/preflight" });
  assert.ok(preflight.includes("--preflight")); assert.ok(!preflight.includes("--backup")); assert.ok(!preflight.includes("--confirm"));
  const execute = buildParallelCutoverArguments({ summary, paths, reportDirectory: "/cutover" });
  for (const flag of ["--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report", "--confirm-parallel-baseline", "--confirm"]) assert.ok(execute.includes(flag));
});

test("missing/wrong approval, changed source, backup failures, and reload failures remain delegated to authoritative validators", async () => {
  const [cli, library, cutover] = await Promise.all([readFile("scripts/legacy-parallel-refresh.mjs", "utf8"), readFile("scripts/lib/legacy-parallel-refresh.mjs", "utf8"), readFile("scripts/legacy-cutover.mjs", "utf8")]);
  assert.match(library, /loadAndValidateRecoveryApprovalV4/);
  assert.match(cli, /FAIL-CLOSED: use the verified backup/);
  assert.match(cutover, /requireVerifiedBackupGate/);
  assert.match(cutover, /loadFinalCutoverAdjudicationContext/);
  assert.match(cutover, /loadFinalCutoverResolutionContext/);
  assert.match(cutover, /resetOperationalData/);
  assert.match(cutover, /verifiedAfterReload/);
  assert.match(cutover, /shop\/admin\/user\/settings records preserved/);
});
