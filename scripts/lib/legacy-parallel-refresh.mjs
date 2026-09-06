import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runSnapshotIntake } from "../legacy-snapshot-intake.mjs";
import { loadAndValidateRecoveryApprovalV4, readRecoveryEvidenceDbf } from "./legacy-customer-recovery-proposal.mjs";
import { resolveLegacySource } from "./legacy-source.mjs";
import { loadOpenOrderSourceRows, readActiveDbfRows } from "./legacy-open-order-source.mjs";
import { loadLegacyOpenOrderHeaders } from "./legacy-open-order-header.mjs";
import { finalizedCollisionEvidence } from "./legacy-final-cutover-adjudication.mjs";
import { loadFinalCutoverAdjudicationContext } from "./legacy-final-cutover-adjudication.mjs";
import { loadFinalCutoverResolutionContext } from "./legacy-final-cutover-resolution.mjs";
import { evidenceHash } from "./legacy-snapshot-evidence.mjs";

export const PARALLEL_REFRESH_FORMAT_VERSION = 1;
export const PARALLEL_REFRESH_STATES = Object.freeze([
  "INTAKE_COMPLETE", "SOURCE_VALIDATED", "REVIEW_REQUIRED", "APPROVED", "PREFLIGHT_PASSED",
  "BACKUP_VERIFIED", "RESET_COMPLETE", "RELOAD_COMPLETE", "VERIFICATION_PASSED", "COMPLETE",
]);
export const CONSOLIDATED_SOURCE_FILES = Object.freeze([
  "Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "laborfinal.FPT", "ar.DBF",
  "orders.DBF", "LABORorder.DBF", "finalsold.DBF", "finalsold.FPT",
  "ordtemps.DBF", "ordtemps.FPT",
]);
export const PARALLEL_REFRESH_CONFIRMATION = "REPLACE_PARALLEL_BASELINE_FROM_WINDOWS";

function value(args, name, required = true) {
  const positions = args.flatMap((item, index) => item === name ? [index] : []);
  if (positions.length > 1 || (required && positions.length !== 1)) throw new Error(`${name} must be provided exactly once.`);
  if (!positions.length) return null;
  const result = args[positions[0] + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}

export function parseParallelRefreshArguments(command, args) {
  const common = new Set(["--config", "--run-root"]);
  const allowed = {
    "adopt-baseline": new Set([...common, "--run", "--cutover-report", "--cutover-backup", "--source-cutover-commit", "--post-cutover-correction-artifact", "--post-cutover-correction-commit"]),
    prepare: new Set([...common, "--zip", "--windows-authority-through", "--shop-id", "--baseline-run", "--baseline-approval", "--baseline-adjudication", "--baseline-resolution"]),
    review: new Set([...common, "--run"]),
    status: new Set([...common, "--run"]),
    execute: new Set([...common, "--run", "--confirm"]),
  }[command];
  if (!allowed) throw new Error("Command must be adopt-baseline, prepare, review, status, or execute.");
  for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);
  const parsed = { command, config: value(args, "--config", false), runRoot: value(args, "--run-root", false) };
  if (command === "adopt-baseline") {
    parsed.run = value(args, "--run");
    parsed.cutoverReport = value(args, "--cutover-report");
    parsed.cutoverBackup = value(args, "--cutover-backup");
    parsed.sourceCutoverCommit = value(args, "--source-cutover-commit");
    parsed.postCutoverCorrectionArtifact = value(args, "--post-cutover-correction-artifact");
    parsed.postCutoverCorrectionCommit = value(args, "--post-cutover-correction-commit");
  } else if (command === "prepare") {
    parsed.zip = value(args, "--zip");
    parsed.windowsAuthorityThrough = value(args, "--windows-authority-through");
    parsed.shopId = value(args, "--shop-id", false);
    parsed.baselineRun = value(args, "--baseline-run", false);
    parsed.baselineApproval = value(args, "--baseline-approval", false);
    parsed.baselineAdjudication = value(args, "--baseline-adjudication", false);
    parsed.baselineResolution = value(args, "--baseline-resolution", false);
    if (parsed.baselineRun && parsed.baselineApproval) throw new Error("Use only one of --baseline-run or --baseline-approval.");
    if (!validDate(parsed.windowsAuthorityThrough)) throw new Error("--windows-authority-through must be a valid YYYY-MM-DD date.");
  } else {
    parsed.run = value(args, "--run");
    if (command === "execute") parsed.confirm = value(args, "--confirm");
  }
  return parsed;
}

export function validateExistingBaselineAdoption({ config, manifest, sourceFingerprint, report, reportPath, backupPath, production, expected, correctionSha256 }) {
  const fail = (condition, message) => { if (!condition) throw new Error(message); };
  fail(manifest?.snapshotDate === "2026-08-29", "Adoption snapshot date mismatch.");
  fail(manifest?.zipSha256 === expected.zipSha256, "Adoption ZIP SHA-256 mismatch.");
  fail(sourceFingerprint === expected.sourceFingerprint, "Adoption source fingerprint mismatch.");
  fail(report?.status?.startsWith("PASS") && report?.mode === "cutover", "Original cutover report did not pass.");
  fail(report?.source?.path && report?.source?.expectedCleanCounts, "Original cutover report is incomplete.");
  fail(report?.source?.expectedCleanCounts?.customers === 3668 && report?.source?.expectedCleanCounts?.vehicles === 5239 && report?.source?.expectedCleanCounts?.invoices === 11727 && report?.source?.expectedCleanCounts?.accounts_receivable === 11727 && report?.source?.expectedCleanCounts?.payments === 11887, "Original cutover expected counts mismatch.");
  fail(report?.verification?.verifiedAfterReload === 1 && report?.verification?.authoritativeBackupVerified === 1 && report?.criticalIssues?.length === 0, "Original cutover verification is not clean.");
  fail(report?.lifecycle?.windowsAuthorityThrough === "2026-08-29", "Original cutover authority date mismatch.");
  fail(correctionSha256 === expected.correctionSha256, "RO 21775 correction artifact SHA-256 mismatch.");
  fail(production.databaseFingerprint === config.expectedDatabaseFingerprint, "Production database fingerprint mismatch.");
  fail(production.shop?.id === config.shopId && production.shop?.name === config.shopName, "Production Shop identity mismatch.");
  fail(production.migrations?.pending === 0 && production.migrations?.failed === 0, `Prisma migrations are not current (pending=${production.migrations?.pending ?? "unknown"}, failed=${production.migrations?.failed ?? "unknown"}).`);
  const countDrift = Object.fromEntries(Object.entries(expected.counts).map(([key, historical]) => [key, {
    historical, current: production.counts?.[key] ?? null,
    delta: typeof production.counts?.[key] === "number" ? production.counts[key] - historical : null,
  }]));
  const currentProductionMatchesHistoricalCounts = Object.values(countDrift).every((entry) => entry.delta === 0);
  return { reportPath, backupPath, verified: true, historicalBaseline: true, currentProductionMatchesHistoricalCounts, countDrift };
}

export async function writeAdoptedBaselineArtifacts({ directory, summary, approvalPath, stalePath, activePath, ordtempsPath, adoptedAt = new Date().toISOString() }) {
  for (const name of ["recovery", "approvals", "evidence"]) await mkdir(join(directory, name), { recursive: true, mode: 0o700 });
  const copies = [
    [approvalPath, join(directory, "recovery", "customer-vehicle-recovery-approval-v4.json")],
    [stalePath, join(directory, "approvals", "active-ro-stale-adjudication-approved.json")],
    [activePath, join(directory, "approvals", "active-ro-resolution-approved.json")],
    [ordtempsPath, join(directory, "approvals", "active-ro-ordtemps-resolution-approved.json")],
  ];
  for (const [source, target] of copies) if (resolve(source) !== resolve(target)) await copyFile(source, target, 0);
  await writeJson(join(directory, "evidence", "recovery-candidates.json"), summary.adoptionEvidence.recovery, true);
  await writeJson(join(directory, "evidence", "active-ro-candidates.json"), summary.adoptionEvidence.activeOrders, true);
  const stored = { ...summary }; delete stored.adoptionEvidence;
  await writeJson(join(directory, "prepare-summary.json"), stored, true);
  await writeFile(join(directory, "prepare-summary.md"), compactPrepareMarkdown(stored), { flag: "wx", mode: 0o600 });
  let state = { runId: stored.runId, createdAt: adoptedAt, adoptedExistingBaseline: true, historicalBaseline: true,
    historicalAuthorityThrough: stored.historicalAuthorityThrough, currentProductionMatchesHistoricalCounts: stored.currentProductionMatchesHistoricalCounts,
    currentProductionDrift: stored.currentProductionDrift, adoptedAt, history: [] };
  for (const stage of PARALLEL_REFRESH_STATES) state = transitionRunState(state, stage, adoptedAt);
  await writeJson(join(directory, "run-state.json"), state, true);
  return state;
}

function expandHome(path) { return path?.startsWith("~/") ? join(homedir(), path.slice(2)) : path; }
export async function loadParallelRefreshConfig(path = "config/legacy-parallel-refresh.json", repositoryRoot = process.cwd()) {
  const resolved = resolve(repositoryRoot, path);
  const config = JSON.parse(await readFile(resolved, "utf8"));
  if (config.formatVersion !== 1 || !config.shopId || !/^[0-9a-f]{64}$/.test(config.expectedDatabaseFingerprint ?? "")) throw new Error("Parallel refresh configuration is invalid.");
  return { ...config, path: resolved, defaultRunRoot: resolve(expandHome(config.defaultRunRoot)) };
}

export function transitionRunState(state, next, at = new Date().toISOString()) {
  const currentIndex = state?.stage ? PARALLEL_REFRESH_STATES.indexOf(state.stage) : -1;
  const nextIndex = PARALLEL_REFRESH_STATES.indexOf(next);
  if (nextIndex < 0 || nextIndex <= currentIndex) throw new Error(`Invalid non-monotonic run-state transition: ${state?.stage ?? "none"} -> ${next}.`);
  return { ...state, formatVersion: PARALLEL_REFRESH_FORMAT_VERSION, stage: next, updatedAt: at, history: [...(state?.history ?? []), { stage: next, at }] };
}

async function writeJson(path, value, exclusive = false) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, ...(exclusive ? { flag: "wx" } : {}) });
}

async function runNodeScript(argumentsList, repositoryRoot) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, argumentsList, { cwd: repositoryRoot, env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${basename(argumentsList[0])} failed (${code ?? "signal"}): ${errorOutput.trim() || "no diagnostic output"}`)));
  });
}

export function parallelRefreshSchemaFingerprint(manifest) {
  const shape = Object.fromEntries(Object.entries(manifest.dbfTables ?? {}).map(([file, table]) => [file, {
    versionByte: table.versionByte, codePageMarker: table.codePageMarker, headerLength: table.headerLength,
    recordLength: table.recordLength, memoFieldPresent: table.memoFieldPresent,
    fields: table.fields?.map((field) => ({ name: field.name, type: field.type, length: field.length, decimalCount: field.decimalCount })),
  }]));
  return evidenceHash(shape);
}

function decisionMap(approval, field) {
  return new Map((approval?.[field] ?? []).map((decision) => [decision.candidateId, evidenceHash(decision)]));
}

export function compareRecoveryBaseline({ proposal, baselineApproval }) {
  const currentCustomers = new Set([...(proposal.candidates ?? []), ...(proposal.unresolvedCandidates ?? [])].map((candidate) => candidate.candidateId));
  const currentVehicles = new Set((proposal.vehicleCandidates ?? []).map((candidate) => candidate.candidateId));
  const priorCustomer = decisionMap(baselineApproval, "decisions");
  const priorVehicle = decisionMap(baselineApproval, "vehicleDecisions");
  const counts = (current, prior) => ({
    current: current.size,
    unchangedCandidates: [...current].filter((key) => prior.has(key)).length,
    newCandidates: [...current].filter((key) => !prior.has(key)).length,
    removedCandidates: [...prior.keys()].filter((key) => !current.has(key)).length,
  });
  const customers = counts(currentCustomers, priorCustomer), vehicles = counts(currentVehicles, priorVehicle);
  return {
    customerCandidateSetEquivalent: proposal.candidateSetSha256 === baselineApproval?.candidateSetSha256,
    vehicleCandidateSetEquivalent: proposal.vehicleCandidateSetSha256 === baselineApproval?.vehicleCandidateSetSha256,
    customerDecisionsAvailableForReuseReview: customers.newCandidates === 0 && customers.removedCandidates === 0,
    vehicleDecisionsAvailableForReuseReview: vehicles.newCandidates === 0 && vehicles.removedCandidates === 0,
    customerDecisionMappings: { identical: customers.unchangedCandidates, changed: 0, missingOrNew: customers.newCandidates + customers.removedCandidates },
    vehicleDecisionMappings: { identical: vehicles.unchangedCandidates, changed: 0, missingOrNew: vehicles.newCandidates + vehicles.removedCandidates },
    customers, vehicles,
  };
}

function text(row, fields) {
  const entry = Object.entries(row.rawData ?? {}).find(([key]) => fields.includes(key.toUpperCase().replaceAll("_", "")));
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}

export function classifyActiveOrderCandidates({ partRows, laborRows, headerRows = [], structuralPartRows = [], structuralLaborRows = [], customers = [], vehicles = [], finalizedRows }) {
  const rows = [
    ...partRows.map((row) => ({ ...row, sourceTable: "orders.DBF" })),
    ...laborRows.map((row) => ({ ...row, sourceTable: "LABORorder.DBF" })),
  ];
  const groups = new Map();
  for (const row of rows) {
    const ro = row.legacyRoNo?.trim() || text(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]);
    if (!ro) continue;
    if (!groups.has(ro)) groups.set(ro, []);
    groups.get(ro).push(row);
  }
  for (const header of headerRows) {
    const ro = header.legacyRoNo?.trim();
    if (!ro) continue;
    if (!groups.has(ro)) groups.set(ro, []);
  }
  const customerIds = new Set(customers.filter((row) => !row.deleted).map((row) => text(row, ["CUSTNO", "CUSTOMERNO"])).filter(Boolean));
  const vehicleOwners = new Map(vehicles.filter((row) => !row.deleted).map((row) => [text(row, ["CARNO", "VEHICLENO"]), text(row, ["CUSTNO", "CUSTOMERNO"])]));
  return [...groups].map(([roNumber, candidates]) => {
    const headers = headerRows.filter((row) => row.legacyRoNo?.trim() === roNumber);
    const structuralParts = structuralPartRows.filter((row) => row.deleted && text(row, ["RONO", "RO", "RONUMBER"]) === roNumber);
    const structuralLabor = structuralLaborRows.filter((row) => row.deleted && text(row, ["RONO", "RO", "RONUMBER"]) === roNumber);
    const evidence = [...candidates, ...headers.map((row) => ({ ...row, sourceTable: "ordtemps.DBF" }))];
    const collision = finalizedCollisionEvidence(roNumber, finalizedRows);
    const finalized = Object.values(collision.sourceRows).some((items) => items.length > 0);
    const customerValues = new Set(evidence.map((row) => row.legacyCustno || text(row, ["CUSTNO", "CUSTOMERNO"])).filter((item) => item && item !== "0"));
    const vehicleValues = new Set(evidence.map((row) => row.legacyCarno || text(row, ["CARNO", "VEHICLENO"])).filter(Boolean));
    const customer = customerValues.size === 1 ? [...customerValues][0] : null;
    const vehicle = vehicleValues.size === 1 ? [...vehicleValues][0] : null;
    const dateValues = new Set(evidence.map((row) => text(row, ["RODATE"])).filter((item) => /^\d{8}$/.test(item ?? "")));
    const date = dateValues.size === 1 ? [...dateValues][0] : null;
    const identityResolved = customer && vehicle && (!customers.length && !vehicles.length || customerIds.has(customer) && vehicleOwners.get(vehicle) === customer);
    const ordtempsOnly = candidates.length === 0 && headers.length > 0;
    const ambiguous = headers.length > 1 || customerValues.size !== 1 || vehicleValues.size !== 1 || dateValues.size !== 1;
    const classification = finalized ? "FINALIZED_STALE_CANDIDATE"
      : ambiguous || !identityResolved ? "UNRESOLVED_REVIEW_REQUIRED"
      : ordtempsOnly ? "ORDTEMPS_ONLY_REVIEW_REQUIRED"
      : "LIKELY_ACTIVE_REVIEW_REQUIRED";
    return {
      roNumber, classification, rowCount: candidates.length,
      partRows: candidates.filter((row) => row.sourceTable === "orders.DBF").length,
      laborRows: candidates.filter((row) => row.sourceTable === "LABORorder.DBF").length,
      ordtempsRows: headers.length, ordtempsOnly, customerLegacyId: customer, vehicleLegacyId: vehicle, identityResolved, sourceDate: date,
      mileage: evidence.map((row) => text(row, ["ODOMETER", "MILEAGE"])).find(Boolean) ?? null,
      laborSummary: [...new Set(candidates.filter((row) => row.sourceTable === "LABORorder.DBF").map((row) => text(row, ["DESCRIPTION", "DESC", "LABOR"])).filter(Boolean))],
      technicianSummary: [...new Set(evidence.map((row) => text(row, ["TECH", "TECHNICIAN", "MECHANIC"])).filter(Boolean))],
      stableRowKeys: evidence.map((row) => row.legacyRowKey).sort(),
      structuralEvidence: [...structuralParts.map((row) => ({ sourceTable: "orders.DBF", stableRowKey: row.stableRowKey, evidenceSha256: row.evidenceSha256, deleted: true })), ...structuralLabor.map((row) => ({ sourceTable: "LABORorder.DBF", stableRowKey: row.stableRowKey, evidenceSha256: row.evidenceSha256, deleted: true }))],
      finalizedCollision: collision,
    };
  }).sort((a, b) => Number(a.roNumber) - Number(b.roNumber));
}

export function compareActiveOrderBaseline({ candidates, adjudication, resolution, ordtempsResolution }) {
  const stale = new Map((adjudication?.activeOpenOrderDecisions ?? []).map((decision) => [String(decision.roNumber), decision]));
  const active = new Map((resolution?.decisions ?? []).map((decision) => [String(decision.roNumber), decision]));
  const ordtemps = new Map((ordtempsResolution?.decisions ?? []).map((decision) => [String(decision.resolved?.roNumber), decision]));
  return candidates.map((candidate) => {
    const staleDecision = stale.get(candidate.roNumber);
    const resolutionDecision = active.get(candidate.roNumber);
    const ordtempsDecision = ordtemps.get(candidate.roNumber);
    const staleKeys = [...(staleDecision?.expectedStableRowKeys ?? [])].sort();
    const resolutionKeys = [...(resolutionDecision?.sourceRows ?? [])].map((row) => row.stableRowKey).sort();
    const priorDecision = staleDecision && JSON.stringify(staleKeys) === JSON.stringify(candidate.stableRowKeys)
      ? "MATCHING_PRIOR_STALE_EXCLUSION"
      : resolutionDecision && JSON.stringify(resolutionKeys) === JSON.stringify(candidate.stableRowKeys)
        ? "MATCHING_PRIOR_ACTIVE_RESOLUTION"
        : ordtempsDecision && candidate.ordtempsOnly ? "MATCHING_PRIOR_ORDTEMPS_RESOLUTION" : "NO_MATCHING_PRIOR_DECISION";
    return { roNumber: candidate.roNumber, priorDecision };
  });
}

export async function loadActiveEvidence(source) {
  const [openRows, headers, allParts, allLabor, customers, vehicles, final, laborFinal, ar, finalSold] = await Promise.all([
    loadOpenOrderSourceRows(source),
    loadLegacyOpenOrderHeaders(source),
    readFile(source.files["orders.DBF"]).then((file) => readRecoveryEvidenceDbf(file, "rawLegacyOrderPart")),
    readFile(source.files["LABORorder.DBF"]).then((file) => readRecoveryEvidenceDbf(file, "rawLegacyOrderLabor")),
    readFile(source.files["Cust.DBF"]).then((file) => readRecoveryEvidenceDbf(file, "rawLegacyCustomer")),
    readFile(source.files["vehicles.DBF"]).then((file) => readRecoveryEvidenceDbf(file, "rawLegacyVehicle")),
    readFile(source.files["FINAL.DBF"]).then(readActiveDbfRows),
    readFile(source.files["laborfinal.DBF"]).then(readActiveDbfRows),
    readFile(source.files["ar.DBF"]).then(readActiveDbfRows),
    readFile(source.files["finalsold.DBF"]).then(readActiveDbfRows),
  ]);
  const wrap = (rows) => rows.map((rawData) => ({ rawData }));
  return classifyActiveOrderCandidates({ ...openRows, headerRows: headers, structuralPartRows: allParts, structuralLaborRows: allLabor, customers, vehicles, finalizedRows: { "FINAL.DBF": wrap(final), "laborfinal.DBF": wrap(laborFinal), "ar.DBF": wrap(ar), "finalsold.DBF": wrap(finalSold) } });
}

async function findRun(root, run) {
  const direct = resolve(run);
  try { if ((await stat(join(direct, "run-state.json"))).isFile()) return direct; } catch {}
  for (const date of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!date.isDirectory()) continue;
    const candidate = join(root, date.name, run);
    try { if ((await stat(join(candidate, "run-state.json"))).isFile()) return candidate; } catch {}
  }
  throw new Error(`Prepared run was not found: ${run}`);
}

export async function resolveParallelRefreshRun({ run, runRoot }) { return findRun(runRoot, run); }

export async function prepareParallelRefresh(options, dependencies = {}) {
  const repositoryRoot = dependencies.repositoryRoot ?? process.cwd();
  const config = dependencies.config ?? await loadParallelRefreshConfig(options.config ?? undefined, repositoryRoot);
  const shopId = options.shopId ?? config.shopId;
  if (shopId !== config.shopId) throw new Error("Requested Shop does not match deployment refresh configuration.");
  const runRoot = resolve(expandHome(options.runRoot) ?? config.defaultRunRoot);
  const dateRoot = join(runRoot, options.windowsAuthorityThrough);
  const intake = await (dependencies.intake ?? runSnapshotIntake)({ zip: options.zip, snapshotDate: options.windowsAuthorityThrough, destination: dateRoot, dryRun: false }, { repositoryRoot });
  const runDirectory = intake.finalPath;
  await chmod(runDirectory, 0o700);
  for (const name of ["recovery", "approvals", "evidence", "preflight", "cutover"]) await mkdir(join(runDirectory, name), { mode: 0o700 });
  let state = transitionRunState({ runId: basename(runDirectory), createdAt: new Date().toISOString(), history: [] }, "INTAKE_COMPLETE");
  await writeJson(join(runDirectory, "run-state.json"), state, true);
  const source = await (dependencies.sourceResolver ?? resolveLegacySource)({ args: ["--source", intake.dataDirectory], requiredFiles: CONSOLIDATED_SOURCE_FILES, repositoryRoot });
  const sourceSchemaFingerprint = parallelRefreshSchemaFingerprint(intake.manifest);
  if (sourceSchemaFingerprint !== config.acceptedDbfSchemaFingerprint) throw new Error("Legacy DBF schema differs from the accepted production format; human/tooling review is required.");
  state = transitionRunState(state, "SOURCE_VALIDATED"); await writeJson(join(runDirectory, "run-state.json"), state);
  const proposalPath = join(runDirectory, "recovery", "customer-vehicle-recovery-proposal.json");
  let proposalResult;
  if (dependencies.proposalWriter) {
    proposalResult = await dependencies.proposalWriter({ snapshotManifestPath: join(runDirectory, "manifest.json"), shopId, output: proposalPath });
  } else {
    await runNodeScript([
      join(repositoryRoot, "scripts", "generate-legacy-customer-recovery-proposal.mjs"),
      "--snapshot-manifest", join(runDirectory, "manifest.json"), "--shop-id", shopId, "--output", proposalPath,
    ], repositoryRoot);
    proposalResult = { proposal: JSON.parse(await readFile(proposalPath, "utf8")) };
  }
  let baselineApproval = null;
  let baselineAdjudication = null, baselineResolution = null, baselineOrdtempsResolution = null;
  if (options.baselineRun) {
    const baselineDirectory = await findRun(runRoot, options.baselineRun);
    baselineApproval = JSON.parse(await readFile(join(baselineDirectory, "recovery", "customer-vehicle-recovery-approval-v4.json"), "utf8"));
    try { baselineAdjudication = JSON.parse(await readFile(join(baselineDirectory, "approvals", "active-ro-stale-adjudication-approved.json"), "utf8")); } catch {}
    try { baselineResolution = JSON.parse(await readFile(join(baselineDirectory, "approvals", "active-ro-resolution-approved.json"), "utf8")); } catch {}
    try { baselineOrdtempsResolution = JSON.parse(await readFile(join(baselineDirectory, "approvals", "active-ro-ordtemps-resolution-approved.json"), "utf8")); } catch {}
  } else if (options.baselineApproval) baselineApproval = JSON.parse(await readFile(resolve(options.baselineApproval), "utf8"));
  if (options.baselineAdjudication) baselineAdjudication = JSON.parse(await readFile(resolve(options.baselineAdjudication), "utf8"));
  if (options.baselineResolution) baselineResolution = JSON.parse(await readFile(resolve(options.baselineResolution), "utf8"));
  const recoveryComparison = compareRecoveryBaseline({ proposal: proposalResult.proposal, baselineApproval });
  const priorCustomers = new Map((baselineApproval?.decisions ?? []).map((decision) => [decision.candidateId, decision]));
  const priorVehicles = new Map((baselineApproval?.vehicleDecisions ?? []).map((decision) => [decision.candidateId, decision]));
  const recoveryEvidencePath = join(runDirectory, "evidence", "recovery-candidates.json");
  await writeJson(recoveryEvidencePath, {
    formatVersion: 1,
    customers: [...proposalResult.proposal.candidates, ...proposalResult.proposal.unresolvedCandidates].map((candidate) => ({
      candidateId: candidate.candidateId, candidateType: candidate.candidateType, legacyCustomerId: candidate.legacyCustomerId,
      orderNumbers: candidate.referencedOrderNumbers, suggestedDecision: candidate.suggestedDecision,
      priorApprovedDecision: priorCustomers.get(candidate.candidateId) ?? null,
    })),
    vehicles: proposalResult.proposal.vehicleCandidates.map((candidate) => ({
      candidateId: candidate.candidateId, classification: candidate.classification, legacyVehicleId: candidate.legacyVehicleId,
      orderNumbers: candidate.affectedOrderNumbers, priorApprovedDecision: priorVehicles.get(candidate.candidateId) ?? null,
    })),
  });
  const activeCandidates = await (dependencies.activeEvidence ?? loadActiveEvidence)(source);
  const activeComparison = compareActiveOrderBaseline({ candidates: activeCandidates, adjudication: baselineAdjudication, resolution: baselineResolution, ordtempsResolution: baselineOrdtempsResolution });
  await writeJson(join(runDirectory, "evidence", "active-ro-candidates.json"), { formatVersion: 1, sourceFingerprint: source.fingerprint, candidates: activeCandidates });
  const summary = {
    formatVersion: 1, runId: basename(runDirectory), status: "READY_FOR_HUMAN_REVIEW", shopId,
    windowsAuthorityThrough: options.windowsAuthorityThrough, zipSha256: intake.manifest.zipSha256,
    snapshotManifest: join(runDirectory, "manifest.json"), sourcePath: source.path, sourceFingerprint: source.fingerprint,
    scopedSourceFingerprint: proposalResult.proposal.snapshot.combinedSourceFingerprint,
    schemaFingerprint: sourceSchemaFingerprint, schemaValidation: "PASS",
    sourceCounts: Object.fromEntries(Object.entries(intake.manifest.dbfTables).map(([file, table]) => [file, table.activeRowCount])),
    recovery: {
      proposalPath, evidencePath: recoveryEvidencePath,
      customerCandidates: proposalResult.proposal.candidates.length + proposalResult.proposal.unresolvedCandidates.length,
      unresolvedCustomerCandidates: proposalResult.proposal.unresolvedCandidates.length,
      vehicleCandidates: proposalResult.proposal.vehicleCandidates.length, comparison: recoveryComparison,
    },
    activeOrders: {
      evidencePath: join(runDirectory, "evidence", "active-ro-candidates.json"), candidates: activeCandidates.length,
      finalizedStaleCandidates: activeCandidates.filter((item) => item.classification === "FINALIZED_STALE_CANDIDATE").length,
      likelyActiveCandidates: activeCandidates.filter((item) => item.classification === "LIKELY_ACTIVE_REVIEW_REQUIRED").length,
      ordtempsOnlyCandidates: activeCandidates.filter((item) => item.classification === "ORDTEMPS_ONLY_REVIEW_REQUIRED").length,
      unresolvedCandidates: activeCandidates.filter((item) => item.classification === "UNRESOLVED_REVIEW_REQUIRED").length,
      priorDecisionMatches: activeComparison.filter((item) => item.priorDecision !== "NO_MATCHING_PRIOR_DECISION").length,
      comparison: activeComparison,
    },
    resetScopeBaseline: dependencies.productionBaseline?.counts ?? null,
    migrationBaseline: dependencies.productionBaseline?.migrations ?? null,
    productionWrites: 0,
    humanActions: ["Review Customer and Vehicle decisions and create a new Recovery Approval v4.", ...(activeCandidates.length ? ["Review every active-RO candidate and create snapshot-bound adjudication/resolution artifacts."] : []), "Run the review command until approval readiness passes."],
  };
  await writeJson(join(runDirectory, "prepare-summary.json"), summary, true);
  await writeFile(join(runDirectory, "prepare-summary.md"), compactPrepareMarkdown(summary), { flag: "wx", mode: 0o600 });
  state = transitionRunState(state, "REVIEW_REQUIRED"); await writeJson(join(runDirectory, "run-state.json"), state);
  return { runDirectory, summary, state };
}

export function compactPrepareMarkdown(summary) {
  const r = summary.recovery, a = summary.activeOrders, c = r.comparison;
  return `# Parallel refresh prepare\n\n- Run: ${summary.runId}\n- Status: **${summary.status}**\n- ZIP SHA-256: ${summary.zipSha256}\n- Full source fingerprint: ${summary.sourceFingerprint}\n- Schema validation: ${summary.schemaValidation}\n- Customer candidates: ${r.customerCandidates} (${c.customers?.newCandidates ?? r.customerCandidates} new, ${c.customers?.unchangedCandidates ?? 0} baseline matches)\n- Vehicle candidates: ${r.vehicleCandidates} (${c.vehicles?.newCandidates ?? r.vehicleCandidates} new, ${c.vehicles?.unchangedCandidates ?? 0} baseline matches)\n- Active-RO candidates: ${a.candidates}; finalized/stale=${a.finalizedStaleCandidates}; likely-active=${a.likelyActiveCandidates}; ordtemps-only=${a.ordtempsOnlyCandidates ?? 0}; unresolved=${a.unresolvedCandidates}\n- Production writes: 0\n\nDetailed evidence: ${dirname(a.evidencePath)}\n`;
}

export async function reviewParallelRefresh({ run, runRoot, config, repositoryRoot = process.cwd() }) {
  const loadedConfig = await loadParallelRefreshConfig(config ?? undefined, repositoryRoot);
  const directory = await findRun(resolve(expandHome(runRoot) ?? loadedConfig.defaultRunRoot), run);
  const summary = JSON.parse(await readFile(join(directory, "prepare-summary.json"), "utf8"));
  const paths = {
    recoveryApproval: join(directory, "recovery", "customer-vehicle-recovery-approval-v4.json"),
    staleAdjudication: join(directory, "approvals", "active-ro-stale-adjudication-approved.json"),
    activeResolution: join(directory, "approvals", "active-ro-resolution-approved.json"),
  };
  let recoveryValid = false;
  try {
    await loadAndValidateRecoveryApprovalV4({ approvalPath: paths.recoveryApproval, proposalPath: summary.recovery.proposalPath, snapshotManifestPath: summary.snapshotManifest, shopId: summary.shopId, repositoryRoot });
    recoveryValid = true;
  } catch {}
  const source = await resolveLegacySource({ args: ["--source", summary.sourcePath], requiredFiles: CONSOLIDATED_SOURCE_FILES, repositoryRoot });
  const validateOptional = async (required, path, loader) => {
    if (!required) return true;
    try {
      await loader({ manifestPath: path, snapshotManifestPath: summary.snapshotManifest, shopId: summary.shopId, source, repositoryRoot });
      return true;
    } catch { return false; }
  };
  const staleReady = await validateOptional(summary.activeOrders.finalizedStaleCandidates > 0, paths.staleAdjudication, loadFinalCutoverAdjudicationContext);
  const resolutionReady = await validateOptional(summary.activeOrders.likelyActiveCandidates + summary.activeOrders.unresolvedCandidates + (summary.activeOrders.ordtempsOnlyCandidates ?? 0) > 0, paths.activeResolution, loadFinalCutoverResolutionContext);
  const activeArtifactsReady = staleReady && resolutionReady;
  return { directory, summary, paths, recoveryValid, staleReady, resolutionReady, activeArtifactsReady, ready: recoveryValid && activeArtifactsReady };
}

function commonCutoverArguments({ summary, paths }) {
  return ["scripts/legacy-cutover.mjs", "--source", summary.sourcePath, "--shop-id", summary.shopId,
    "--customer-recovery-proposal", summary.recovery.proposalPath, "--customer-recovery-manifest", paths.recoveryApproval,
    "--snapshot-manifest", summary.snapshotManifest,
    ...(paths.staleAdjudication ? ["--final-cutover-adjudication", paths.staleAdjudication] : []),
    ...(paths.activeResolution ? ["--final-cutover-active-ro-resolution", paths.activeResolution] : []),
    "--payment-date-policy", "invoice-date-proxy", "--cutover-mode", "parallel-baseline", "--windows-authority-through", summary.windowsAuthorityThrough];
}

export function buildParallelPreflightArguments({ summary, paths, reportDirectory }) {
  return [...commonCutoverArguments({ summary, paths }), "--preflight", "--report", "--report-dir", reportDirectory, "--summary-only"];
}

export function buildParallelCutoverArguments({ summary, paths, reportDirectory }) {
  return [...commonCutoverArguments({ summary, paths }), "--backup", "--reset-operational-data", "--reload-legacy", "--verify", "--report", "--report-dir", reportDirectory,
    "--confirm-parallel-baseline", PARALLEL_REFRESH_CONFIRMATION, "--confirm", "RESET_SHOP_OPERATIONAL_DATA"];
}

export function validateParallelExecutionSafety({ config, summary, shop, databaseFingerprint, migrationStatus, currentCounts }) {
  if (summary.historicalBaseline || summary.adoptedExistingBaseline) throw new Error("Historical adopted baselines are comparison-only and cannot authorize execution.");
  if (databaseFingerprint !== config.expectedDatabaseFingerprint) throw new Error("Production database fingerprint mismatch.");
  if (shop?.id !== config.shopId || shop?.name !== config.shopName || summary.shopId !== config.shopId) throw new Error("Production Shop identity mismatch.");
  if (migrationStatus?.pending || migrationStatus?.failed) throw new Error("Prisma migration state blocks refresh execution.");
  if (summary.resetScopeBaseline && JSON.stringify(summary.resetScopeBaseline) !== JSON.stringify(currentCounts)) throw new Error("Production reset scope changed after prepare; run prepare again.");
  return true;
}
