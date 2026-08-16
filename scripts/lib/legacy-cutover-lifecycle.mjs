export const PARALLEL_BASELINE_MODE = "parallel-baseline";
export const FINAL_PRODUCTION_MODE = "final-production";
export const PARALLEL_BASELINE_CONFIRMATION = "REPLACE_PARALLEL_BASELINE_FROM_WINDOWS";
export const FINAL_PRODUCTION_CONFIRMATION = "FINALIZE_WINDOWS_PRODUCTION_CUTOVER";

export const LEGACY_CUTOVER_COMPLETED = "legacy_cutover_completed";
export const PARALLEL_BASELINE_COMPLETED = "legacy_parallel_baseline_completed";
export const FINAL_PRODUCTION_COMPLETED = "legacy_final_production_cutover_completed";
export const CUTOVER_LIFECYCLE_ACTIONS = Object.freeze([
  LEGACY_CUTOVER_COMPLETED,
  PARALLEL_BASELINE_COMPLETED,
  FINAL_PRODUCTION_COMPLETED,
]);

function singleArgument(argv, name) {
  const positions = argv.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length > 1) throw new Error(`${name} may be supplied only once.`);
  if (!positions.length) return null;
  const value = argv[positions[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires an explicit value.`);
  return value;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function parseCutoverLifecycle(argv = [], { confirmedFullReplacement = false } = {}) {
  const mode = singleArgument(argv, "--cutover-mode");
  const parallelConfirmation = singleArgument(argv, "--confirm-parallel-baseline");
  const finalConfirmation = singleArgument(argv, "--confirm-final-production");
  const windowsAuthorityThrough = singleArgument(argv, "--windows-authority-through");

  if (mode && ![PARALLEL_BASELINE_MODE, FINAL_PRODUCTION_MODE].includes(mode)) {
    throw new Error("--cutover-mode must equal parallel-baseline or final-production.");
  }
  if (!mode && (parallelConfirmation || finalConfirmation || windowsAuthorityThrough)) {
    throw new Error("Lifecycle confirmation and authority flags require an explicit --cutover-mode.");
  }
  if (mode === PARALLEL_BASELINE_MODE) {
    if (finalConfirmation) throw new Error("Parallel-baseline mode cannot use final-production confirmation.");
    if (!windowsAuthorityThrough || !validDate(windowsAuthorityThrough)) {
      throw new Error("Parallel-baseline mode requires --windows-authority-through YYYY-MM-DD.");
    }
    if (confirmedFullReplacement && parallelConfirmation !== PARALLEL_BASELINE_CONFIRMATION) {
      throw new Error(`Parallel-baseline replacement requires --confirm-parallel-baseline ${PARALLEL_BASELINE_CONFIRMATION}.`);
    }
    if (parallelConfirmation && parallelConfirmation !== PARALLEL_BASELINE_CONFIRMATION) {
      throw new Error(`--confirm-parallel-baseline must equal ${PARALLEL_BASELINE_CONFIRMATION}.`);
    }
  }
  if (mode === FINAL_PRODUCTION_MODE) {
    if (parallelConfirmation || windowsAuthorityThrough) {
      throw new Error("Final-production mode cannot use parallel-baseline lifecycle flags.");
    }
    if (confirmedFullReplacement && finalConfirmation !== FINAL_PRODUCTION_CONFIRMATION) {
      throw new Error(`Final-production cutover requires --confirm-final-production ${FINAL_PRODUCTION_CONFIRMATION}.`);
    }
    if (finalConfirmation && finalConfirmation !== FINAL_PRODUCTION_CONFIRMATION) {
      throw new Error(`--confirm-final-production must equal ${FINAL_PRODUCTION_CONFIRMATION}.`);
    }
  }
  return { mode: mode ?? "legacy", windowsAuthorityThrough };
}

export function assertCutoverLifecycleAllowed({ lifecycle, priorMarkers = [], confirmedFullReplacement = false }) {
  if (!confirmedFullReplacement) return;
  const actions = new Set(priorMarkers.map((marker) => marker.action));
  if (actions.has(FINAL_PRODUCTION_COMPLETED)) {
    throw new Error("A final production cutover is already recorded for this shop. No later full Windows replacement is permitted.");
  }
  if (lifecycle.mode === "legacy" && actions.has(LEGACY_CUTOVER_COMPLETED)) {
    throw new Error("A completed legacy cutover is already recorded for this shop. Default full Windows replacement remains one-way and cannot be run again.");
  }
}

export function completionActionForMode(mode) {
  if (mode === PARALLEL_BASELINE_MODE) return PARALLEL_BASELINE_COMPLETED;
  if (mode === FINAL_PRODUCTION_MODE) return FINAL_PRODUCTION_COMPLETED;
  return LEGACY_CUTOVER_COMPLETED;
}

export function completionMetadata({ lifecycle, snapshot, sourceFingerprint, repositoryCommit, reportReference, invoiceArImportRunId }) {
  return {
    sourceType: "Shopman32 DBF",
    driver: "legacy-cutover",
    cutoverMode: lifecycle.mode,
    sourceSnapshotDate: snapshot?.snapshotDate ?? null,
    sourceZipSha256: snapshot?.zipSha256 ?? null,
    snapshotManifestSha256: snapshot?.snapshotManifestSha256 ?? null,
    combinedSourceFingerprint: snapshot?.combinedSourceFingerprint ?? sourceFingerprint,
    repositoryCommit,
    windowsAuthorityThrough: lifecycle.windowsAuthorityThrough,
    reportReference,
    invoiceArImportRunId,
  };
}
