import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateSnapshotManifestForRecovery } from "./legacy-recovery-upgrade.mjs";
import { readActiveDbfRows, loadOpenOrderSourceRows } from "./legacy-open-order-source.mjs";

export const FINAL_CUTOVER_ADJUDICATION_VERSION = 1;
export const FINAL_CUTOVER_ADJUDICATION_TYPE = "final-cutover-active-ro-adjudication";
export const EXCLUDE_STALE_ACTIVE_RO = "exclude-stale-active-source-artifact";
export const STALE_DUPLICATE_CLASSIFICATION = "strongly-indicated-stale-duplicate-residue";
export const PROVEN_STALE_DUPLICATE_CLASSIFICATION = "proven-stale-duplicate-residue";
export const FINAL_CUTOVER_ADJUDICATION_FLAG = "--final-cutover-adjudication";
export const SNAPSHOT_MANIFEST_FLAG = "--snapshot-manifest";
export const RELEVANT_SOURCE_FILES = Object.freeze([
  "orders.DBF", "LABORorder.DBF", "FINAL.DBF", "laborfinal.DBF", "ar.DBF",
]);

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function argument(args, name) {
  const positions = args.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length > 1) throw new Error(`${name} must not be supplied more than once.`);
  if (!positions.length) return null;
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires an explicit file path.`);
  return value;
}

export function finalCutoverAdjudicationArguments(args = process.argv.slice(2)) {
  const manifestPath = argument(args, FINAL_CUTOVER_ADJUDICATION_FLAG);
  const snapshotManifestPath = argument(args, SNAPSHOT_MANIFEST_FLAG);
  if (Boolean(manifestPath) !== Boolean(snapshotManifestPath)) {
    throw new Error(`${FINAL_CUTOVER_ADJUDICATION_FLAG} and ${SNAPSHOT_MANIFEST_FLAG} must be supplied together.`);
  }
  return { manifestPath, snapshotManifestPath };
}

async function readableManifest(path, repositoryRoot) {
  const requested = resolve(path);
  const protectedPath = resolve(repositoryRoot, "OriginalWinApp");
  let protectedResolved = protectedPath;
  try { protectedResolved = await realpath(protectedPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  let resolvedPath;
  try { resolvedPath = await realpath(requested); } catch (error) {
    if (error?.code === "ENOENT") throw new Error("Final-cutover adjudication manifest does not exist.");
    throw error;
  }
  if (isWithin(protectedPath, requested) || isWithin(protectedResolved, resolvedPath)) {
    throw new Error("Final-cutover adjudication manifest must not be inside OriginalWinApp.");
  }
  await access(resolvedPath, constants.R_OK);
  if (!(await stat(resolvedPath)).isFile()) throw new Error("Final-cutover adjudication manifest must be a readable regular file.");
  const bytes = await readFile(resolvedPath);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Final-cutover adjudication manifest is not valid JSON."); }
  return { path: resolvedPath, bytes, manifest, fingerprint: createHash("sha256").update(bytes).digest("hex") };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function rowHash(rawData) {
  return createHash("sha256").update(JSON.stringify(canonicalize(rawData))).digest("hex");
}

function identifier(rawData, candidates) {
  const entry = Object.entries(rawData).find(([key]) => candidates.includes(key.toUpperCase().replaceAll("_", "")));
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}

function roNumber(row) {
  return row.legacyRoNo?.trim() ?? identifier(row.rawData, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]);
}

export function finalizedCollisionEvidence(ro, finalizedRows) {
  const sourceRows = {};
  const matches = [];
  for (const [table, rows] of Object.entries(finalizedRows)) {
    const tableMatches = rows.filter((row) => roNumber(row) === ro);
    matches.push(...tableMatches);
    sourceRows[table] = tableMatches.map((row) => rowHash(row.rawData)).sort();
  }
  const values = (candidates) => [...new Set(matches.map((row) => identifier(row.rawData, candidates)).filter(Boolean))].sort();
  return {
    roNumber: ro,
    customerKeys: values(["CUSTNO", "CUSTOMERNO"]),
    vehicleKeys: values(["CARNO", "VEHICLENO"]),
    roDates: values(["RODATE"]),
    soldDates: values(["DATESOLD"]),
    sourceRows,
  };
}

function exact(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function nonblank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateFinalCutoverAdjudication({
  manifest,
  manifestFingerprint,
  shopId,
  source,
  snapshot,
  openRows,
  finalizedRows,
}) {
  const fatalIssues = [];
  const fail = (code, roNumberValue = null) => fatalIssues.push({ code, legacyRoNo: roNumberValue });
  if (manifest?.formatVersion !== FINAL_CUTOVER_ADJUDICATION_VERSION || manifest?.manifestType !== FINAL_CUTOVER_ADJUDICATION_TYPE) fail("invalid-adjudication-format");
  if (manifest?.shopId !== shopId) fail("adjudication-shop-mismatch");
  const binding = manifest?.snapshot;
  if (!binding || binding.snapshotDate !== snapshot.manifest.snapshotDate) fail("adjudication-snapshot-date-mismatch");
  if (binding?.zipSha256 !== snapshot.manifest.zipSha256) fail("adjudication-zip-hash-mismatch");
  if (binding?.snapshotManifestSha256 !== snapshot.manifestFingerprint) fail("adjudication-snapshot-manifest-mismatch");
  if (binding?.combinedSourceFingerprint !== source.fingerprint) fail("adjudication-source-fingerprint-mismatch");
  for (const file of RELEVANT_SOURCE_FILES) {
    if (binding?.sourceHashes?.[file] !== source.fingerprints[file]) fail("adjudication-source-file-hash-mismatch");
  }
  if (!Array.isArray(manifest?.activeOpenOrderDecisions) || manifest.activeOpenOrderDecisions.length === 0) fail("missing-active-ro-decisions");

  const allOpenRows = [
    ...openRows.partRows.map((row) => ({ ...row, sourceTable: "orders.DBF" })),
    ...openRows.laborRows.map((row) => ({ ...row, sourceTable: "LABORorder.DBF" })),
  ];
  const excludedRowKeys = new Set();
  const reviewedExclusions = [];
  const seenRos = new Set();
  for (const decision of manifest?.activeOpenOrderDecisions ?? []) {
    const ro = Number.isSafeInteger(decision?.roNumber) && decision.roNumber > 0 ? String(decision.roNumber) : null;
    if (!ro) { fail("invalid-adjudication-ro-number"); continue; }
    if (seenRos.has(ro)) { fail("duplicate-adjudication-ro-decision", ro); continue; }
    seenRos.add(ro);
    if (decision.decision !== EXCLUDE_STALE_ACTIVE_RO) fail("unsupported-active-ro-decision", ro);
    if (decision.approved !== true || !nonblank(decision.reviewedBy) || !nonblank(decision.reviewedAt) || Number.isNaN(Date.parse(decision.reviewedAt))) fail("unapproved-active-ro-decision", ro);
    if (![PROVEN_STALE_DUPLICATE_CLASSIFICATION, STALE_DUPLICATE_CLASSIFICATION].includes(decision.classification) || !nonblank(decision.reason)) fail("invalid-active-ro-review-evidence", ro);
    const rows = allOpenRows.filter((row) => roNumber(row) === ro);
    const actualTables = { "orders.DBF": rows.filter((row) => row.sourceTable === "orders.DBF").length, "LABORorder.DBF": rows.filter((row) => row.sourceTable === "LABORorder.DBF").length };
    const actualKeys = rows.map((row) => row.legacyRowKey).sort();
    if (decision.expectedRecordCount !== rows.length) fail("adjudication-source-row-count-mismatch", ro);
    if (!exact(decision.expectedTables, actualTables)) fail("adjudication-source-table-count-mismatch", ro);
    if (!exact([...(decision.expectedStableRowKeys ?? [])].sort(), actualKeys)) fail("adjudication-source-row-key-mismatch", ro);
    const collision = finalizedCollisionEvidence(ro, finalizedRows);
    if (!Object.values(collision.sourceRows).some((rowsForTable) => rowsForTable.length)) fail("adjudication-finalized-collision-missing", ro);
    if (!exact(decision.expectedFinalizedCollision, collision)) fail("adjudication-finalized-collision-mismatch", ro);
    if (!fatalIssues.some((issue) => issue.legacyRoNo === ro)) {
      for (const key of actualKeys) excludedRowKeys.add(key);
      reviewedExclusions.push({
        legacyRoNo: ro,
        decision: decision.decision,
        classification: decision.classification,
        reason: decision.reason,
        sourceRows: rows.length,
      });
    }
  }
  if (fatalIssues.length) return { fatalIssues, excludedRowKeys: new Set(), reviewedExclusions: [], manifestFingerprint };
  return { fatalIssues, excludedRowKeys, reviewedExclusions, manifestFingerprint };
}

export async function loadFinalCutoverAdjudicationContext({
  manifestPath,
  snapshotManifestPath,
  shopId,
  source,
  repositoryRoot = process.cwd(),
}) {
  const [loaded, snapshot] = await Promise.all([
    readableManifest(manifestPath, repositoryRoot),
    validateSnapshotManifestForRecovery({ manifestPath: snapshotManifestPath, repositoryRoot }),
  ]);
  if (snapshot.source.path !== source.path || snapshot.sourceFingerprint !== source.fingerprint) {
    throw new Error("Snapshot manifest does not identify the selected legacy source directory.");
  }
  snapshot.path = await realpath(snapshotManifestPath);
  snapshot.manifestFingerprint = createHash("sha256").update(await readFile(snapshotManifestPath)).digest("hex");
  const openRows = await loadOpenOrderSourceRows(source);
  const [final, laborFinal, ar] = await Promise.all([
    readFile(source.files["FINAL.DBF"]).then(readActiveDbfRows),
    readFile(source.files["laborfinal.DBF"]).then(readActiveDbfRows),
    readFile(source.files["ar.DBF"]).then(readActiveDbfRows),
  ]);
  const plan = validateFinalCutoverAdjudication({
    manifest: loaded.manifest,
    manifestFingerprint: loaded.fingerprint,
    shopId,
    source,
    snapshot,
    openRows,
    finalizedRows: { "FINAL.DBF": final, "laborfinal.DBF": laborFinal, "ar.DBF": ar },
  });
  if (plan.fatalIssues.length) throw new Error(`Final-cutover adjudication rejected: ${plan.fatalIssues[0].code}.`);
  return { ...loaded, snapshot, plan };
}
