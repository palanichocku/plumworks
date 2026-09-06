#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseIdentityFromUrl } from "./lib/public-db-backup.mjs";
import { validateSchemaReadiness } from "./lib/legacy-refresh-rehearsal.mjs";
import {
  buildParallelCutoverArguments, buildParallelPreflightArguments, CONSOLIDATED_SOURCE_FILES, loadParallelRefreshConfig, PARALLEL_REFRESH_CONFIRMATION,
  compareActiveOrderBaseline, compareRecoveryBaseline, loadActiveEvidence, parseParallelRefreshArguments, prepareParallelRefresh,
  reviewParallelRefresh, transitionRunState, validateExistingBaselineAdoption, validateParallelExecutionSafety, writeAdoptedBaselineArtifacts,
} from "./lib/legacy-parallel-refresh.mjs";
import { loadAndValidateRecoveryApprovalV4 } from "./lib/legacy-customer-recovery-proposal.mjs";
import { loadFinalCutoverAdjudicationContext } from "./lib/legacy-final-cutover-adjudication.mjs";
import { loadFinalCutoverResolutionContext } from "./lib/legacy-final-cutover-resolution.mjs";
import { artifactSha256, loadOrdtempsResolutionEvidence, ORDTEMPS_RESOLUTION_FILES, validateOrdtempsResolution } from "./lib/legacy-ordtemps-open-order-resolution.mjs";
import { validateSnapshotManifestForRecovery } from "./lib/legacy-recovery-upgrade.mjs";
import { resolveLegacySource } from "./lib/legacy-source.mjs";

function printPrepare(summary, directory) {
  const r = summary.recovery, c = r.comparison, a = summary.activeOrders;
  console.log("PARALLEL REFRESH PREPARE");
  console.log(`Run: ${summary.runId}`); console.log(`ZIP SHA: ${summary.zipSha256}`);
  console.log(`Windows authority through: ${summary.windowsAuthorityThrough}`); console.log(`Source fingerprint: ${summary.sourceFingerprint}`);
  console.log(`Schema validation: ${summary.schemaValidation}`);
  console.log(`Recovery Customers: ${r.customerCandidates}; baseline matches=${c.customers?.unchangedCandidates ?? 0}; new=${c.customers?.newCandidates ?? r.customerCandidates}`);
  console.log(`Recovery Vehicles: ${r.vehicleCandidates}; baseline matches=${c.vehicles?.unchangedCandidates ?? 0}; new=${c.vehicles?.newCandidates ?? r.vehicleCandidates}`);
  console.log(`Active ROs: ${a.candidates}; stale/finalized=${a.finalizedStaleCandidates}; likely active=${a.likelyActiveCandidates}; unresolved=${a.unresolvedCandidates}`);
  console.log(`Matching prior active-RO decisions available for re-review: ${a.priorDecisionMatches}`);
  if (summary.resetScopeBaseline) console.log(`Current production baseline: Customers=${summary.resetScopeBaseline.customers}; Vehicles=${summary.resetScopeBaseline.vehicles}; Invoices=${summary.resetScopeBaseline.invoices}; AR=${summary.resetScopeBaseline.accountsReceivable}; Payments=${summary.resetScopeBaseline.payments}; ROs=${summary.resetScopeBaseline.repairOrders}`);
  console.log("Production writes: 0"); console.log("Human action: review and create new snapshot-bound approval artifacts.");
  console.log(`Detailed artifacts: ${directory}`); console.log("STATUS: READY FOR HUMAN REVIEW");
}

async function runChild(args) {
  const sessionUrl = process.env.SESSION_POOLER_URL;
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: sessionUrl ? { ...process.env, DATABASE_URL: sessionUrl, DIRECT_URL: sessionUrl } : process.env,
    });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Consolidated cutover failed with exit code ${code}.`)));
  });
}

async function productionBaseline(prisma, shopId) {
  const models = [["customers", "customer"], ["vehicles", "vehicle"], ["invoices", "invoice"], ["payments", "payment"], ["accountsReceivable", "accountReceivable"], ["repairOrders", "repairOrder"]];
  const counts = Object.fromEntries(await Promise.all(models.map(async ([label, model]) => [label, await prisma[model].count({ where: { shopId } })])));
  const migrations = await prisma.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"');
  return { counts, migrations: { applied: migrations.filter((row) => row.finished_at && !row.rolled_back_at).length, failed: migrations.filter((row) => !row.finished_at && !row.rolled_back_at).length } };
}

const ADOPTION_EXPECTED = Object.freeze({
  zipSha256: "c2a6f10180ad52951d50df20cef4af5429af9e4711ca73dd2655a323feccc786",
  sourceFingerprint: "3d00c28c5162a83a852c317714fd63153c222cc32e898b7283b75a4fbd714f56",
  correctionSha256: "bb93ff74c97a112fb5e179df8dd3c71688f2ba8b765f7fcb3b2b88a17744c5ca",
  counts: { customers: 3668, vehicles: 5239, invoices: 11727, accountsReceivable: 11727, payments: 11887, repairOrders: 2 },
  controlTotals: { january2026: "13608.61", h1_2026: "130599.15", year2025: "273292.61" },
});
const AUGUST_29_CUTOVER_SOURCE_FILES = Object.freeze(CONSOLIDATED_SOURCE_FILES.filter((file) => !file.startsWith("ordtemps.")));

async function fileSha256(path) {
  const hash = createHash("sha256");
  await new Promise((done, reject) => { const input = createReadStream(path); input.on("data", (chunk) => hash.update(chunk)); input.once("error", reject); input.once("end", done); });
  return hash.digest("hex");
}

async function assertGitCommit(commit) {
  await new Promise((done, reject) => {
    const child = spawn("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error(`Required provenance commit is unavailable: ${commit}`)));
  });
}

async function adoptionProductionEvidence(prisma, config) {
  const baseline = await productionBaseline(prisma, config.shopId);
  const [shop, operationalRepairOrders, january, h1, year, nativeCounts, applied] = await Promise.all([
    prisma.shop.findUnique({ where: { id: config.shopId }, select: { id: true, name: true } }),
    prisma.repairOrder.findMany({ where: { shopId: config.shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } }, select: { repairOrderNumber: true, legacyRoNo: true }, orderBy: { repairOrderNumber: "asc" } }),
    prisma.invoice.aggregate({ where: { shopId: config.shopId, OR: [{ legacySourceTable: null, status: "closed", closedAt: { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-02-01T00:00:00Z") } }, { legacySourceTable: { not: null }, invoiceDate: { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-02-01T00:00:00Z") } }] }, _sum: { total: true } }),
    prisma.invoice.aggregate({ where: { shopId: config.shopId, OR: [{ legacySourceTable: null, status: "closed", closedAt: { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-07-01T00:00:00Z") } }, { legacySourceTable: { not: null }, invoiceDate: { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-07-01T00:00:00Z") } }] }, _sum: { total: true } }),
    prisma.invoice.aggregate({ where: { shopId: config.shopId, OR: [{ legacySourceTable: null, status: "closed", closedAt: { gte: new Date("2025-01-01T00:00:00Z"), lt: new Date("2026-01-01T00:00:00Z") } }, { legacySourceTable: { not: null }, invoiceDate: { gte: new Date("2025-01-01T00:00:00Z"), lt: new Date("2026-01-01T00:00:00Z") } }] }, _sum: { total: true } }),
    Promise.all(["customer", "vehicle", "invoice", "accountReceivable", "payment"].map((model) => prisma[model].count({ where: { shopId: config.shopId, legacySourceTable: null } }))),
    prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'),
  ]);
  const schema = await validateSchemaReadiness(process.cwd(), applied.map((row) => row.migration_name));
  return { ...baseline, shop, operationalRepairOrders, databaseFingerprint: databaseIdentityFromUrl(process.env.DIRECT_URL).fingerprint,
    migrations: { ...baseline.migrations, pending: schema.unappliedMigrations },
    controlTotals: { january2026: String(january._sum.total ?? "0"), h1_2026: String(h1._sum.total ?? "0"), year2025: String(year._sum.total ?? "0") },
    unexpectedNativeBusinessRows: nativeCounts.reduce((sum, count) => sum + count, 0),
  };
}

async function adoptBaseline(options) {
  console.log("PARALLEL REFRESH BASELINE ADOPTION");
  const config = await loadParallelRefreshConfig(options.config ?? undefined);
  const directory = resolve(options.run);
  const manifestPath = join(directory, "manifest.json");
  const recoveryRoot = join(dirname(directory), "recovery");
  const proposalPath = join(recoveryRoot, "customer-vehicle-recovery-proposal.json");
  const approvalPath = join(recoveryRoot, "customer-vehicle-recovery-approval-v4.json");
  const stalePath = join(recoveryRoot, "active-ro-stale-adjudication-approved.json");
  const activePath = join(recoveryRoot, "active-ro-21773-resolution-approved.json");
  const reportPath = resolve(options.cutoverReport), backupPath = resolve(options.cutoverBackup), ordtempsPath = resolve(options.postCutoverCorrectionArtifact);
  for (const path of [manifestPath, proposalPath, approvalPath, stalePath, activePath, reportPath, ordtempsPath, join(backupPath, "manifest.json"), join(backupPath, "plumworks-public-cutover.dump"), join(backupPath, "sha256.txt")]) await stat(path);
  for (const commit of [options.sourceCutoverCommit, options.postCutoverCorrectionCommit]) await assertGitCommit(commit);
  const [manifest, report, proposal, approval, ordtempsBytes, backupManifest] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse), readFile(reportPath, "utf8").then(JSON.parse), readFile(proposalPath, "utf8").then(JSON.parse),
    readFile(approvalPath, "utf8").then(JSON.parse), readFile(ordtempsPath), readFile(join(backupPath, "manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (await fileSha256(join(backupPath, "plumworks-public-cutover.dump")) !== backupManifest.sha256 || backupManifest.verification?.status !== "passed") throw new Error("Original cutover backup verification failed.");
  console.log("Immutable snapshot provenance and verified backup: PASS");
  const source = await resolveLegacySource({ args: ["--source", report.source.path], requiredFiles: AUGUST_29_CUTOVER_SOURCE_FILES, repositoryRoot: process.cwd() });
  const evidenceSource = await resolveLegacySource({ args: ["--source", report.source.path], requiredFiles: CONSOLIDATED_SOURCE_FILES, repositoryRoot: process.cwd() });
  const ordtempsSource = await resolveLegacySource({ args: ["--source", report.source.path], requiredFiles: ORDTEMPS_RESOLUTION_FILES, repositoryRoot: process.cwd() });
  if (source.fingerprint !== ADOPTION_EXPECTED.sourceFingerprint) throw new Error("August 29 consolidated source fingerprint mismatch.");
  console.log("Snapshot source bindings: PASS");
  await loadAndValidateRecoveryApprovalV4({ approvalPath, proposalPath, snapshotManifestPath: manifestPath, shopId: config.shopId });
  console.log("Recovery Approval v4: PASS");
  await loadFinalCutoverAdjudicationContext({ manifestPath: stalePath, snapshotManifestPath: manifestPath, shopId: config.shopId, source });
  console.log("RO 11159 stale adjudication: PASS");
  await loadFinalCutoverResolutionContext({ manifestPath: activePath, snapshotManifestPath: manifestPath, shopId: config.shopId, source });
  console.log("RO 21773 active resolution: PASS");
  const snapshot = await validateSnapshotManifestForRecovery({ manifestPath });
  const ordtempsEvidence = await loadOrdtempsResolutionEvidence(ordtempsSource, 21775);
  console.log("RO 21775 source evidence: PASS");
  const ordtempsValidation = validateOrdtempsResolution({ artifact: JSON.parse(ordtempsBytes), artifactSha256: artifactSha256(ordtempsBytes), snapshotManifest: snapshot.manifest, snapshotManifestSha256: await fileSha256(manifestPath), source: ordtempsSource, evidence: ordtempsEvidence });
  if (ordtempsValidation.issues.length) throw new Error(`RO 21775 approval rejected: ${ordtempsValidation.issues[0].code}.`);
  console.log("Recovery and active-RO approvals: PASS");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL ?? process.env.DATABASE_URL }) });
  let production; try { production = await adoptionProductionEvidence(prisma, config); } finally { await prisma.$disconnect(); }
  console.log(`Migration status: pending=${production.migrations.pending}; failed=${production.migrations.failed}`);
  const adoptionValidation = validateExistingBaselineAdoption({ config, manifest, sourceFingerprint: source.fingerprint, report, reportPath, backupPath, production, expected: ADOPTION_EXPECTED, correctionSha256: artifactSha256(ordtempsBytes) });
  console.log("Read-only production baseline: PASS");
  const activeCandidates = await loadActiveEvidence(evidenceSource);
  const activeComparison = compareActiveOrderBaseline({ candidates: activeCandidates, adjudication: JSON.parse(await readFile(stalePath)), resolution: JSON.parse(await readFile(activePath)), ordtempsResolution: JSON.parse(ordtempsBytes) });
  const comparison = compareRecoveryBaseline({ proposal, baselineApproval: approval });
  const adoptedAt = new Date().toISOString();
  const summary = { formatVersion: 1, runId: directory.split("/").at(-1), status: "COMPLETE", shopId: config.shopId, windowsAuthorityThrough: "2026-08-29", zipSha256: manifest.zipSha256,
    snapshotManifest: manifestPath, sourcePath: source.path, sourceFingerprint: source.fingerprint, scopedSourceFingerprint: proposal.snapshot.combinedSourceFingerprint,
    schemaFingerprint: config.acceptedDbfSchemaFingerprint, schemaValidation: "PASS", sourceCounts: report.source.rowCounts,
    recovery: { proposalPath: join(directory, "recovery", "customer-vehicle-recovery-proposal.json"), evidencePath: join(directory, "evidence", "recovery-candidates.json"), customerCandidates: proposal.candidates.length + proposal.unresolvedCandidates.length, unresolvedCustomerCandidates: proposal.unresolvedCandidates.length, vehicleCandidates: proposal.vehicleCandidates.length, comparison },
    activeOrders: { evidencePath: join(directory, "evidence", "active-ro-candidates.json"), candidates: activeCandidates.length, finalizedStaleCandidates: activeCandidates.filter((x) => x.classification === "FINALIZED_STALE_CANDIDATE").length, likelyActiveCandidates: activeCandidates.filter((x) => x.classification === "LIKELY_ACTIVE_REVIEW_REQUIRED").length, ordtempsOnlyCandidates: activeCandidates.filter((x) => x.classification === "ORDTEMPS_ONLY_REVIEW_REQUIRED").length, unresolvedCandidates: activeCandidates.filter((x) => x.classification === "UNRESOLVED_REVIEW_REQUIRED").length, priorDecisionMatches: activeComparison.filter((x) => x.priorDecision !== "NO_MATCHING_PRIOR_DECISION").length, comparison: activeComparison },
    resetScopeBaseline: ADOPTION_EXPECTED.counts, migrationBaseline: production.migrations, productionWrites: 0, adoptedExistingBaseline: true,
    historicalBaseline: true, historicalAuthorityThrough: "2026-08-29", adoptedAt,
    historicalExpectedCounts: ADOPTION_EXPECTED.counts,
    currentProductionAtAdoption: { counts: production.counts, operationalRepairOrders: production.operationalRepairOrders, controlTotals: production.controlTotals, migrations: production.migrations },
    currentProductionMatchesHistoricalCounts: adoptionValidation.currentProductionMatchesHistoricalCounts,
    currentProductionDrift: adoptionValidation.countDrift,
    provenance: { sourceCutoverReport: reportPath, sourceCutoverBackup: backupPath, sourceCutoverCommit: options.sourceCutoverCommit, postCutoverCorrectionArtifact: ordtempsPath, postCutoverCorrectionArtifactSha256: artifactSha256(ordtempsBytes), postCutoverCorrectionCommit: options.postCutoverCorrectionCommit },
    validations: { snapshot: "PASS", recoveryApprovalV4: "PASS", ro11159: "PASS", ro21773: "PASS", ro21775: "PASS", cutoverReport: "PASS", backup: "PASS", production: "PASS", migrations: "PASS", controlTotals: "PASS" },
    adoptionEvidence: { recovery: { formatVersion: 1, candidateIds: [...proposal.candidates, ...proposal.unresolvedCandidates].map((x) => x.candidateId), vehicleCandidateIds: proposal.vehicleCandidates.map((x) => x.candidateId), decisionMappings: { customers: approval.decisions, vehicles: approval.vehicleDecisions } }, activeOrders: { formatVersion: 1, sourceFingerprint: source.fingerprint, candidates: activeCandidates, priorDecisionComparison: activeComparison } }, humanActions: [] };
  const state = await writeAdoptedBaselineArtifacts({ directory, summary, approvalPath, stalePath, activePath, ordtempsPath, adoptedAt });
  console.log(`Run: ${summary.runId}`); console.log(`Snapshot/cutover/correction/production verification: PASS`);
  console.log(`Current production matches historical counts: ${summary.currentProductionMatchesHistoricalCounts}`);
  console.log(`Recorded count drift: ${JSON.stringify(summary.currentProductionDrift)}`);
  console.log(`Run state: ${state.stage}`); console.log("Production writes: 0"); console.log(`Artifacts: ${directory}`);
}

async function main() {
  const command = process.argv[2], options = parseParallelRefreshArguments(command, process.argv.slice(3));
  if (command === "adopt-baseline") { await adoptBaseline(options); return; }
  if (command === "prepare") {
    const config = await loadParallelRefreshConfig(options.config ?? undefined);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL ?? process.env.DATABASE_URL }) });
    let baseline;
    try { baseline = await productionBaseline(prisma, config.shopId); } finally { await prisma.$disconnect(); }
    const result = await prepareParallelRefresh(options, { config, productionBaseline: baseline }); printPrepare(result.summary, result.runDirectory); return;
  }
  const review = await reviewParallelRefresh(options);
  if (command === "review") {
    console.log("PARALLEL REFRESH REVIEW"); console.log(`Run: ${review.summary.runId}`);
    console.log(`Recovery Approval v4: ${review.recoveryValid ? "VALID" : "REQUIRED"}`);
    console.log(`Active-RO approvals: ${review.activeArtifactsReady ? "PRESENT" : "REQUIRED"}`);
    console.log(`Customer candidates: ${review.summary.recovery.customerCandidates}; Vehicle candidates: ${review.summary.recovery.vehicleCandidates}`);
    console.log(`Recovery decision evidence: ${review.summary.recovery.evidencePath}`);
    console.log(`Active-RO evidence: ${review.summary.activeOrders.evidencePath}`);
    console.log(`STATUS: ${review.ready ? "APPROVED — READY FOR PREFLIGHT" : "HUMAN APPROVAL REQUIRED"}`); return;
  }
  if (command === "status") {
    console.log(await readFile(join(review.directory, "run-state.json"), "utf8")); return;
  }
  if (options.confirm !== PARALLEL_REFRESH_CONFIRMATION) throw new Error(`--confirm must equal ${PARALLEL_REFRESH_CONFIRMATION}.`);
  if (!review.ready) throw new Error("Run is not ready: required human approval artifacts are missing or invalid.");
  const config = await loadParallelRefreshConfig(options.config ?? undefined);
  const identity = databaseIdentityFromUrl(process.env.DIRECT_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL ?? process.env.DATABASE_URL }) });
  let currentBaseline;
  try {
    const shop = await prisma.shop.findUnique({ where: { id: config.shopId }, select: { id: true, name: true } });
    currentBaseline = await productionBaseline(prisma, config.shopId);
    const migrations = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const schema = await validateSchemaReadiness(process.cwd(), migrations.map((row) => row.migration_name));
    validateParallelExecutionSafety({ config, summary: review.summary, shop, databaseFingerprint: identity.fingerprint, migrationStatus: { pending: schema.unappliedMigrations, failed: currentBaseline.migrations.failed }, currentCounts: currentBaseline.counts });
  } finally { await prisma.$disconnect(); }
  const statePath = join(review.directory, "run-state.json");
  let state = JSON.parse(await readFile(statePath, "utf8")); state = transitionRunState(state, "APPROVED"); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  const paths = { ...review.paths };
  for (const key of ["staleAdjudication", "activeResolution"]) try { await stat(paths[key]); } catch { paths[key] = null; }
  try {
    await runChild(buildParallelPreflightArguments({ summary: review.summary, paths, reportDirectory: join(review.directory, "preflight") }));
    state = transitionRunState(state, "PREFLIGHT_PASSED"); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await runChild(buildParallelCutoverArguments({ summary: review.summary, paths, reportDirectory: join(review.directory, "cutover") }));
    for (const stage of ["BACKUP_VERIFIED", "RESET_COMPLETE", "RELOAD_COMPLETE", "VERIFICATION_PASSED", "COMPLETE"]) { state = transitionRunState(state, stage); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); }
  } catch (error) {
    console.error("FAIL-CLOSED: use the verified backup and restore procedure in docs/cutover-runbook.md; do not perform ad-hoc production repair."); throw error;
  }
}

await main().catch((error) => { console.error(`Parallel refresh failed: ${error instanceof Error ? error.message : "Unknown error."}`); process.exitCode = 1; });
