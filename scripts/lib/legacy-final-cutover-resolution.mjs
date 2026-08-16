import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateSnapshotManifestForRecovery } from "./legacy-recovery-upgrade.mjs";
import { loadOpenOrderSourceRows, readActiveDbfRows } from "./legacy-open-order-source.mjs";
import { canonicalJson, evidenceHash } from "./legacy-snapshot-evidence.mjs";
import { finalizedCollisionEvidence } from "./legacy-final-cutover-adjudication.mjs";

export const FINAL_CUTOVER_RESOLUTION_VERSION = 1;
export const FINAL_CUTOVER_RESOLUTION_TYPE = "final-cutover-active-ro-resolution";
export const FINAL_CUTOVER_RESOLUTION_FLAG = "--final-cutover-active-ro-resolution";
export const RESOLVE_ACTIVE_RO = "resolve-reviewed-active-repair-order";
export const INCLUDE_SOURCE_ROW = "include-source-row";
export const EXCLUDE_STRUCTURAL_SOURCE_ROW = "exclude-structural-source-row";
export const RESOLUTION_SOURCE_FILES = Object.freeze([
  "Cust.DBF", "vehicles.DBF", "orders.DBF", "LABORorder.DBF", "FINAL.DBF", "laborfinal.DBF", "ar.DBF",
]);

function within(parent, child) {
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

export function finalCutoverResolutionArguments(args = process.argv.slice(2)) {
  const manifestPath = argument(args, FINAL_CUTOVER_RESOLUTION_FLAG);
  const snapshotManifestPath = argument(args, "--snapshot-manifest");
  if (manifestPath && !snapshotManifestPath) throw new Error(`${FINAL_CUTOVER_RESOLUTION_FLAG} requires --snapshot-manifest.`);
  return { manifestPath, snapshotManifestPath };
}

async function privateManifest(path, repositoryRoot) {
  const requested = resolve(path);
  const gitRoot = await realpath(repositoryRoot);
  const originalRoot = resolve(repositoryRoot, "OriginalWinApp");
  const resolvedPath = await realpath(requested).catch((error) => {
    if (error?.code === "ENOENT") throw new Error("Final-cutover active-RO resolution does not exist.");
    throw error;
  });
  if (within(gitRoot, resolvedPath) || within(originalRoot, resolvedPath)) throw new Error("Final-cutover active-RO resolution must be private and outside Git/OriginalWinApp.");
  await access(resolvedPath, constants.R_OK);
  if (!(await stat(resolvedPath)).isFile()) throw new Error("Final-cutover active-RO resolution must be a regular file.");
  const bytes = await readFile(resolvedPath);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Final-cutover active-RO resolution is not valid JSON."); }
  return { path: resolvedPath, bytes, value, fingerprint: createHash("sha256").update(bytes).digest("hex") };
}

function exact(left, right) { return canonicalJson(left) === canonicalJson(right); }
function nonblank(value) { return typeof value === "string" && value.trim().length > 0; }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  try { return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; } catch { return false; }
}
function identifier(rawData, candidates) {
  const entry = Object.entries(rawData ?? {}).find(([key]) => candidates.includes(key.toUpperCase().replaceAll("_", "")));
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}
function sourceRows(openRows) {
  return [
    ...openRows.partRows.map((row) => ({ ...row, sourceTable: "orders.DBF" })),
    ...openRows.laborRows.map((row) => ({ ...row, sourceTable: "LABORorder.DBF" })),
  ].map((row) => ({
    ...row,
    legacyRoNo: row.legacyRoNo?.trim() ?? identifier(row.rawData, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]),
    legacyCustno: row.legacyCustno?.trim() ?? identifier(row.rawData, ["CUSTNO", "CUSTOMERNO"]),
    legacyCarno: row.legacyCarno?.trim() ?? identifier(row.rawData, ["CARNO", "VEHICLENO"]),
  }));
}

export function validateFinalCutoverResolution({ manifest, manifestFingerprint, shopId, source, snapshot, openRows, finalizedRows = { "FINAL.DBF": [], "laborfinal.DBF": [], "ar.DBF": [] } }) {
  const fatalIssues = [];
  const fail = (code, legacyRoNo = null) => fatalIssues.push({ code, legacyRoNo });
  if (manifest?.formatVersion !== FINAL_CUTOVER_RESOLUTION_VERSION || manifest?.artifactType !== FINAL_CUTOVER_RESOLUTION_TYPE) fail("invalid-active-ro-resolution-format");
  if (manifest?.shopId !== shopId) fail("active-ro-resolution-shop-mismatch");
  const binding = manifest?.snapshot;
  if (binding?.snapshotDate !== snapshot.manifest.snapshotDate) fail("active-ro-resolution-snapshot-date-mismatch");
  if (binding?.zipSha256 !== snapshot.manifest.zipSha256) fail("active-ro-resolution-zip-mismatch");
  if (binding?.snapshotManifestSha256 !== snapshot.manifestFingerprint) fail("active-ro-resolution-snapshot-manifest-mismatch");
  if (binding?.combinedSourceFingerprint !== source.fingerprint) fail("active-ro-resolution-source-fingerprint-mismatch");
  for (const file of RESOLUTION_SOURCE_FILES) if (binding?.sourceHashes?.[file] !== source.fingerprints[file]) fail("active-ro-resolution-source-file-mismatch");
  if (manifest?.approval?.approved !== true || !nonblank(manifest?.approval?.reviewedBy) || !nonblank(manifest?.approval?.reviewedAt) || Number.isNaN(Date.parse(manifest?.approval?.reviewedAt)) || !nonblank(manifest?.approval?.reason)) fail("unapproved-active-ro-resolution");
  if (!Array.isArray(manifest?.decisions) || manifest.decisions.length === 0) fail("missing-active-ro-resolution-decisions");

  const actualRows = sourceRows(openRows);
  const rowActions = new Map();
  const reviewedResolutions = [];
  const seenRos = new Set();
  for (const decision of manifest?.decisions ?? []) {
    const ro = Number.isSafeInteger(decision?.roNumber) && decision.roNumber > 0 ? String(decision.roNumber) : null;
    if (!ro) { fail("invalid-active-ro-resolution-number"); continue; }
    if (seenRos.has(ro)) { fail("duplicate-active-ro-resolution", ro); continue; }
    seenRos.add(ro);
    if (decision.action !== RESOLVE_ACTIVE_RO || !nonblank(decision.reason)) fail("unsupported-active-ro-resolution", ro);
    if (!nonblank(decision.resolved?.customerLegacyId) || !nonblank(decision.resolved?.vehicleLegacyId) || !validDate(decision.resolved?.roDate) || !Number.isSafeInteger(decision.resolved?.mileage) || decision.resolved.mileage < 0) fail("invalid-active-ro-resolved-values", ro);
    const collision = finalizedCollisionEvidence(ro, finalizedRows);
    if (!exact(decision.expectedFinalizedCollision, collision)) fail("active-ro-resolution-finalized-collision-mismatch", ro);
    if (Object.values(collision.sourceRows).some((rows) => rows.length)) fail("active-ro-resolution-finalized-collision", ro);
    const rows = actualRows.filter((row) => row.legacyRoNo?.trim() === ro);
    const expected = decision.sourceRows ?? [];
    if (expected.length !== rows.length) fail("active-ro-resolution-row-count-mismatch", ro);
    const expectedKeys = expected.map((row) => row.stableRowKey).sort();
    if (!exact(expectedKeys, rows.map((row) => row.legacyRowKey).sort())) fail("active-ro-resolution-row-key-mismatch", ro);
    for (const evidence of expected) {
      const actual = rows.find((row) => row.legacyRowKey === evidence.stableRowKey);
      if (!actual) continue;
      if (evidence.sourceTable !== actual.sourceTable || evidence.deleted !== false || evidence.evidenceSha256 !== evidenceHash(actual.rawData)) fail("active-ro-resolution-row-evidence-mismatch", ro);
      if (![INCLUDE_SOURCE_ROW, EXCLUDE_STRUCTURAL_SOURCE_ROW].includes(evidence.disposition)) fail("invalid-active-ro-row-disposition", ro);
      if (evidence.disposition === EXCLUDE_STRUCTURAL_SOURCE_ROW && actual.sourceTable !== "orders.DBF") fail("invalid-structural-row-exclusion", ro);
      const oldCustomer = actual.legacyCustno?.trim() || null;
      if ((evidence.oldCustomerLegacyId ?? null) !== oldCustomer) fail("active-ro-resolution-old-customer-mismatch", ro);
      if ((evidence.oldVehicleLegacyId ?? null) !== (actual.legacyCarno?.trim() || null)) fail("active-ro-resolution-old-vehicle-mismatch", ro);
      if ((evidence.oldRoDate ?? null) !== (actual.rawData?.RO_DATE?.toString().trim() || null)) fail("active-ro-resolution-old-date-mismatch", ro);
      if ((evidence.oldMileage ?? null) !== (actual.rawData?.ODOMETER?.toString().trim() || null)) fail("active-ro-resolution-old-mileage-mismatch", ro);
      if (oldCustomer && oldCustomer !== "0" && oldCustomer !== decision.resolved.customerLegacyId) fail("active-ro-resolution-contradictory-customer", ro);
      rowActions.set(actual.legacyRowKey, { disposition: evidence.disposition, resolved: decision.resolved, roNumber: ro });
    }
    if (!fatalIssues.some((issue) => issue.legacyRoNo === ro)) reviewedResolutions.push({
      legacyRoNo: ro,
      action: decision.action,
      includedSourceRows: expected.filter((row) => row.disposition === INCLUDE_SOURCE_ROW).length,
      excludedStructuralSourceRows: expected.filter((row) => row.disposition === EXCLUDE_STRUCTURAL_SOURCE_ROW).length,
      reason: decision.reason,
    });
  }
  if (fatalIssues.length) return { fatalIssues, rowActions: new Map(), reviewedResolutions: [], manifestFingerprint };
  return { fatalIssues, rowActions, reviewedResolutions, manifestFingerprint };
}

export function applyFinalCutoverResolution({ partRows, laborRows, resolutionPlan }) {
  if (!resolutionPlan) return { partRows, laborRows };
  const apply = (rows) => rows.flatMap((row) => {
    const action = resolutionPlan.rowActions.get(row.legacyRowKey);
    if (!action) return [row];
    if (action.disposition === EXCLUDE_STRUCTURAL_SOURCE_ROW) return [];
    const customer = action.resolved.customerLegacyId;
    return [{
      ...row,
      legacyCustno: customer,
      legacyCarno: action.resolved.vehicleLegacyId,
      rawData: {
        ...row.rawData,
        CUSTNO: customer,
        CARNO: action.resolved.vehicleLegacyId,
        RO_DATE: action.resolved.roDate.replaceAll("-", ""),
        ODOMETER: String(action.resolved.mileage),
      },
    }];
  });
  return { partRows: apply(partRows), laborRows: apply(laborRows) };
}

export async function loadFinalCutoverResolutionContext({ manifestPath, snapshotManifestPath, shopId, source, repositoryRoot = process.cwd() }) {
  const [loaded, snapshot] = await Promise.all([
    privateManifest(manifestPath, repositoryRoot),
    validateSnapshotManifestForRecovery({ manifestPath: snapshotManifestPath, repositoryRoot }),
  ]);
  if (snapshot.source.path !== source.path || snapshot.sourceFingerprint !== source.fingerprint) throw new Error("Snapshot manifest does not identify the selected legacy source directory.");
  snapshot.path = await realpath(snapshotManifestPath);
  snapshot.manifestFingerprint = createHash("sha256").update(await readFile(snapshotManifestPath)).digest("hex");
  const [openRows, final, laborFinal, ar] = await Promise.all([
    loadOpenOrderSourceRows(source),
    readFile(source.files["FINAL.DBF"]).then(readActiveDbfRows),
    readFile(source.files["laborfinal.DBF"]).then(readActiveDbfRows),
    readFile(source.files["ar.DBF"]).then(readActiveDbfRows),
  ]);
  const evidenceRows = (rows) => rows.map((rawData) => ({ rawData }));
  const plan = validateFinalCutoverResolution({
    manifest: loaded.value, manifestFingerprint: loaded.fingerprint, shopId, source, snapshot, openRows,
    finalizedRows: { "FINAL.DBF": evidenceRows(final), "laborfinal.DBF": evidenceRows(laborFinal), "ar.DBF": evidenceRows(ar) },
  });
  if (plan.fatalIssues.length) throw new Error(`Final-cutover active-RO resolution rejected: ${plan.fatalIssues[0].code}.`);
  return { ...loaded, snapshot, plan };
}
