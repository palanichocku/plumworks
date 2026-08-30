import assert from "node:assert/strict";
import test from "node:test";
import { legacySourceFingerprint, validateSnapshotBoundSourceScope } from "./lib/legacy-source.mjs";
import { recoveryPlanSourceFingerprint } from "./lib/legacy-customer-recovery-proposal.mjs";

const required = ["Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "laborfinal.FPT", "ar.DBF", "orders.DBF", "LABORorder.DBF"];
const extra = ["finalsold.DBF", "finalsold.FPT"];
const all = [...required, ...extra];
const hashes = Object.fromEntries(all.map((file, index) => [file, (index + 1).toString(16).repeat(64)]));
const root = "/immutable/snapshot";
const data = `${root}/Shopman32/data`;

function source(files = all, overrides = {}) {
  return {
    path: data,
    files: Object.fromEntries(files.map((file) => [file, `${data}/${file}`])),
    actualFiles: Object.fromEntries(files.map((file) => [file, file])),
    fingerprints: Object.fromEntries(files.map((file) => [file, hashes[file]])),
    fingerprint: legacySourceFingerprint(files, hashes),
    ...overrides,
  };
}

function fixture() {
  const snapshotSource = source(required);
  const manifest = {
    requiredFileValidation: { required },
    files: Object.fromEntries(all.map((file) => [`Shopman32/data/${file}`, { sha256: hashes[file] }])),
  };
  return {
    snapshot: { manifest, snapshotRoot: root, source: snapshotSource },
    cutoverSource: source(),
    binding: { combinedSourceFingerprint: snapshotSource.fingerprint, sourceHashes: { ...snapshotSource.fingerprints } },
  };
}

test("artifact scope accepts the same eight immutable files inside a larger consolidated source", () => {
  const result = validateSnapshotBoundSourceScope(fixture());
  assert.deepEqual(result.issues, []);
  assert.equal(result.scopedSource.fingerprint, legacySourceFingerprint(required, hashes));
  assert.deepEqual(Object.keys(result.scopedSource.files), required);
});

test("artifact scope fails closed for a changed bound hash", () => {
  const value = fixture();
  value.cutoverSource.fingerprints["orders.DBF"] = "f".repeat(64);
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "artifact-source-file-hash-mismatch"));
});

test("artifact scope fails closed for a missing bound file", () => {
  const value = fixture();
  delete value.cutoverSource.files["orders.DBF"];
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "artifact-source-file-missing"));
});

test("artifact scope fails closed for substituted path identity", () => {
  const value = fixture();
  value.cutoverSource.files["orders.DBF"] = `${data}/renamed-orders.DBF`;
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "artifact-source-file-identity-mismatch"));
});

test("artifact scope fails closed for a different immutable snapshot directory", () => {
  const value = fixture();
  value.cutoverSource.path = "/immutable/other/Shopman32/data";
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "snapshot-source-directory-mismatch"));
});

test("aggregate mismatch does not pass when required scoped files do not match", () => {
  const value = fixture();
  value.binding.combinedSourceFingerprint = value.cutoverSource.fingerprint;
  value.binding.sourceHashes["LABORorder.DBF"] = "f".repeat(64);
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "artifact-source-file-hash-mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "artifact-scoped-fingerprint-mismatch"));
});

test("extra consolidated files remain independently bound to the immutable manifest", () => {
  const value = fixture();
  value.cutoverSource.fingerprints["finalsold.DBF"] = "f".repeat(64);
  const result = validateSnapshotBoundSourceScope(value);
  assert.ok(result.issues.some((issue) => issue.code === "cutover-source-manifest-hash-mismatch" && issue.file === "finalsold.DBF"));
});

test("validated Recovery Approval v4 uses its scoped fingerprint instead of the consolidated superset fingerprint", () => {
  const scoped = "a".repeat(64);
  assert.equal(recoveryPlanSourceFingerprint({
    approval: { snapshot: { combinedSourceFingerprint: scoped } },
    manifest: { sourceBinding: { sourceFingerprint: scoped } },
    consolidatedSourceFingerprint: "b".repeat(64),
  }), scoped);
  assert.throws(() => recoveryPlanSourceFingerprint({
    approval: { snapshot: { combinedSourceFingerprint: scoped } },
    manifest: { sourceBinding: { sourceFingerprint: "c".repeat(64) } },
    consolidatedSourceFingerprint: "b".repeat(64),
  }), /inconsistent/);
});
