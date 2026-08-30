#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseIdentityFromUrl } from "./lib/public-db-backup.mjs";
import { validateSchemaReadiness } from "./lib/legacy-refresh-rehearsal.mjs";
import {
  buildParallelCutoverArguments, buildParallelPreflightArguments, loadParallelRefreshConfig, PARALLEL_REFRESH_CONFIRMATION,
  parseParallelRefreshArguments, prepareParallelRefresh, reviewParallelRefresh, transitionRunState, validateParallelExecutionSafety,
} from "./lib/legacy-parallel-refresh.mjs";

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

async function main() {
  const command = process.argv[2], options = parseParallelRefreshArguments(command, process.argv.slice(3));
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
    validateParallelExecutionSafety({ config, summary: review.summary, shop, databaseFingerprint: identity.fingerprint, migrationStatus: { pending: schema.unappliedMigrations.length, failed: currentBaseline.migrations.failed }, currentCounts: currentBaseline.counts });
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

main().catch((error) => { console.error(`Parallel refresh failed: ${error instanceof Error ? error.message : "Unknown error."}`); process.exitCode = 1; });
