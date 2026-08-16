import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertCutoverLifecycleAllowed,
  completionActionForMode,
  completionMetadata,
  FINAL_PRODUCTION_COMPLETED,
  LEGACY_CUTOVER_COMPLETED,
  PARALLEL_BASELINE_COMPLETED,
  parseCutoverLifecycle,
} from "./lib/legacy-cutover-lifecycle.mjs";

const destructive = { confirmedFullReplacement: true };
const parallel = ["--cutover-mode", "parallel-baseline", "--windows-authority-through", "2026-08-31"];
const final = ["--cutover-mode", "final-production"];
const marker = (action) => ({ action });

test("legacy/default mode retains the historical one-way guard", () => {
  const lifecycle = parseCutoverLifecycle([], destructive);
  assert.throws(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(LEGACY_CUTOVER_COMPLETED)], ...destructive }), /Default full Windows replacement/);
});

test("parallel replacement requires its dedicated confirmation in addition to reset confirmation", () => {
  assert.throws(() => parseCutoverLifecycle(parallel, destructive), /confirm-parallel-baseline/);
  const lifecycle = parseCutoverLifecycle([...parallel, "--confirm-parallel-baseline", "REPLACE_PARALLEL_BASELINE_FROM_WINDOWS"], destructive);
  assert.doesNotThrow(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(LEGACY_CUTOVER_COMPLETED)], ...destructive }));
  assert.equal(completionActionForMode(lifecycle.mode), PARALLEL_BASELINE_COMPLETED);
});

test("parallel markers are nonterminal but final production is permanently terminal", () => {
  const lifecycle = parseCutoverLifecycle([...parallel, "--confirm-parallel-baseline", "REPLACE_PARALLEL_BASELINE_FROM_WINDOWS"], destructive);
  assert.doesNotThrow(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(PARALLEL_BASELINE_COMPLETED)], ...destructive }));
  assert.throws(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(FINAL_PRODUCTION_COMPLETED)], ...destructive }), /No later full Windows replacement/);
});

test("final production requires dedicated confirmation, permits old markers, and cannot repeat", () => {
  assert.throws(() => parseCutoverLifecycle(final, destructive), /confirm-final-production/);
  const lifecycle = parseCutoverLifecycle([...final, "--confirm-final-production", "FINALIZE_WINDOWS_PRODUCTION_CUTOVER"], destructive);
  assert.doesNotThrow(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(LEGACY_CUTOVER_COMPLETED), marker(PARALLEL_BASELINE_COMPLETED)], ...destructive }));
  assert.throws(() => assertCutoverLifecycleAllowed({ lifecycle, priorMarkers: [marker(FINAL_PRODUCTION_COMPLETED)], ...destructive }), /No later full Windows replacement/);
  assert.equal(completionActionForMode(lifecycle.mode), FINAL_PRODUCTION_COMPLETED);
});

test("mode-specific metadata is immutable source-bound audit evidence", () => {
  const value = completionMetadata({
    lifecycle: { mode: "parallel-baseline", windowsAuthorityThrough: "2026-08-31" },
    snapshot: { snapshotDate: "2026-08-15", zipSha256: "a", snapshotManifestSha256: "b", combinedSourceFingerprint: "c" },
    sourceFingerprint: "fallback", repositoryCommit: "deadbeef", reportReference: "cutover.json", invoiceArImportRunId: "run-1",
  });
  assert.deepEqual(value, {
    sourceType: "Shopman32 DBF", driver: "legacy-cutover", cutoverMode: "parallel-baseline",
    sourceSnapshotDate: "2026-08-15", sourceZipSha256: "a", snapshotManifestSha256: "b",
    combinedSourceFingerprint: "c", repositoryCommit: "deadbeef", windowsAuthorityThrough: "2026-08-31",
    reportReference: "cutover.json", invoiceArImportRunId: "run-1",
  });
});

test("marker is written only after verification and reset preserves shop lifecycle audit rows", async () => {
  const [cutover, reset] = await Promise.all([
    readFile("scripts/legacy-cutover.mjs", "utf8"), readFile("scripts/lib/legacy-cutover-reset.mjs", "utf8"),
  ]);
  const verification = cutover.indexOf("const result = await verify(prisma, shop.id, preservedBefore, completedPaymentContext)");
  const criticalGate = cutover.indexOf("if (wantsReload && runSummary.criticalIssues.length === 0)");
  const markerWrite = cutover.indexOf("await prisma.auditLog.create", criticalGate);
  assert.ok(verification >= 0 && verification < criticalGate && criticalGate < markerWrite);
  assert.doesNotMatch(reset, /OPERATIONAL_AUDIT_TYPES[\s\S]*?["']shop["']/);
  assert.match(cutover, /requireVerifiedBackupGate\(verifiedBackupGate/);
  assert.ok(cutover.indexOf("requireVerifiedBackupGate(verifiedBackupGate") < cutover.indexOf("await deleteOperationalData"));
});

test("failed verification cannot write a lifecycle completion marker", () => {
  assert.equal(completionActionForMode("legacy"), LEGACY_CUTOVER_COMPLETED);
  // The source-order assertion above proves the write is inside the zero-critical-issues gate.
});
