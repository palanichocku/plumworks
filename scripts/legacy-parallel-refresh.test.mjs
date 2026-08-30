import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildParallelCutoverArguments, buildParallelPreflightArguments, classifyActiveOrderCandidates, compareActiveOrderBaseline,
  compareRecoveryBaseline, parseParallelRefreshArguments, transitionRunState, validateParallelExecutionSafety,
} from "./lib/legacy-parallel-refresh.mjs";

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
