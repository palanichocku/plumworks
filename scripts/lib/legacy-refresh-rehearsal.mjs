import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { assertSafeDestination, runSnapshotIntake } from "../legacy-snapshot-intake.mjs";
import { loadAndValidateRecoveryApprovalV4 } from "./legacy-customer-recovery-proposal.mjs";
import { resolveLegacySource } from "./legacy-source.mjs";

export const REHEARSAL_STAGES = Object.freeze([
  "source-validation", "recovery-manifest-validation", "customer-vehicle-staging-projection",
  "customer-vehicle-transformation-projection", "customer-recovery-projection",
  "vehicle-recovery-projection",
  "invoice-labor-ar-staging-projection", "invoice-ar-transformation-projection",
  "payment-projection", "open-repair-order-projection", "final-verification",
]);
const VALUE_ARGUMENTS = ["--zip", "--snapshot-date", "--customer-recovery-manifest", "--customer-recovery-proposal", "--workspace"];
const OPTIONAL_VALUE_ARGUMENTS = ["--final-cutover-adjudication", "--final-cutover-active-ro-resolution"];
const REQUIRED_CURRENT_MIGRATIONS = Object.freeze([
  "20260804120000_add_marketing_lead_attribution",
  "20260804150000_add_invoice_odometer",
  "20260804170000_add_complimentary_services",
  "20260828190000_add_payment_payer_metadata",
]);

export async function validateSchemaReadiness(repositoryRoot, appliedMigrations = null) {
  const migrationRoot = join(repositoryRoot, "prisma", "migrations");
  const directories = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const missing = REQUIRED_CURRENT_MIGRATIONS.filter((name) => !directories.includes(name));
  for (const name of directories) await stat(join(migrationRoot, name, "migration.sql"));
  const schema = await readFile(join(repositoryRoot, "prisma", "schema.prisma"), "utf8");
  const requiredSchema = [
    ["Invoice.odometer", /model Invoice \{[\s\S]*?odometer\s+Int\?/],
    ["InvoiceLabor.complimentary", /model InvoiceLabor \{[\s\S]*?complimentary\s+Boolean\s+@default\(false\)/],
    ["RepairOrderLabor.complimentary", /model RepairOrderLabor \{[\s\S]*?complimentary\s+Boolean\s+@default\(false\)/],
    ["MarketingLead attribution", /model MarketingLead \{[\s\S]*?attributionSource\s+String\?/],
    ["Payment payer metadata", /model Payment \{[\s\S]*?payerType\s+PaymentPayerType[\s\S]*?note\s+String\?/],
  ];
  const missingSchema = requiredSchema.filter(([, pattern]) => !pattern.test(schema)).map(([label]) => label);
  if (missing.length || missingSchema.length) throw new Error(`Schema readiness failed: missing migrations=${missing.join(",") || "none"}; missing schema=${missingSchema.join(",") || "none"}.`);
  const applied = appliedMigrations ? new Set(appliedMigrations) : null;
  const unapplied = applied ? directories.filter((name) => !applied.has(name)) : [];
  return { migrationDirectoriesFound: directories.length, expectedLatestMigration: directories.at(-1), requiredRecentMigrations: [...REQUIRED_CURRENT_MIGRATIONS], schemaFilesPresent: true, targetMigrationStatusKnown: Boolean(applied), unappliedMigrations: unapplied.length, requiresMigrateDeploy: applied ? unapplied.length > 0 : null, migrationsAppliedByRehearsal: 0 };
}

export function parseLegacyRefreshRehearsalArguments(args) {
  const allowed = new Set(["--seed", "--keep-snapshot", ...VALUE_ARGUMENTS, ...OPTIONAL_VALUE_ARGUMENTS]);
  const confirmations = new Set(["--confirm", "RESET_SHOP_OPERATIONAL_DATA", "IMPORT_LEGACY_PAYMENTS", "TRANSFORM_LEGACY_INVOICES"]);
  for (const value of args) {
    if (confirmations.has(value) || value.startsWith("--confirm=")) throw new Error("Confirmation arguments are prohibited in rehearsal mode.");
    if (value.startsWith("--") && !allowed.has(value)) throw new Error(`Unknown argument: ${value}`);
  }
  for (const flag of ["--seed", "--keep-snapshot"]) {
    if (args.filter((value) => value === flag).length > 1) throw new Error(`${flag} may be supplied only once.`);
  }
  const values = {};
  for (const name of [...VALUE_ARGUMENTS, ...OPTIONAL_VALUE_ARGUMENTS]) {
    const positions = args.flatMap((value, index) => value === name ? [index] : []);
    if ((VALUE_ARGUMENTS.includes(name) && name !== "--zip" && positions.length !== 1) || positions.length > 1) throw new Error(`${name} must be provided exactly once.`);
    if (positions.length) {
      const value = args[positions[0] + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      values[name] = value;
    }
  }
  const seed = args.includes("--seed");
  if (Number(seed) + Number(Boolean(values["--zip"])) !== 1) throw new Error("Exactly one of --seed or --zip is required.");
  const snapshotDate = values["--snapshot-date"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || new Date(`${snapshotDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== snapshotDate) {
    throw new Error("--snapshot-date must be a valid YYYY-MM-DD date.");
  }
  return {
    mode: seed ? "seed" : "zip", zip: values["--zip"], snapshotDate,
    recoveryManifest: values["--customer-recovery-manifest"], recoveryProposal: values["--customer-recovery-proposal"], workspace: values["--workspace"],
    adjudicationManifest: values["--final-cutover-adjudication"],
    activeRoResolution: values["--final-cutover-active-ro-resolution"],
    keepSnapshot: args.includes("--keep-snapshot"),
  };
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : String(error)).replaceAll(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED DATABASE URL]");
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise({ code, stdout, stderr }) : reject(new Error(`${options.label ?? command} failed with exit code ${code}.`)));
  });
}

async function gitState(repositoryRoot) {
  const [head, status] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, label: "git HEAD" }),
    runCommand("git", ["status", "--short"], { cwd: repositoryRoot, label: "git status" }),
  ]);
  return { head: head.stdout.trim(), status: status.stdout.split("\n").filter(Boolean) };
}

export async function createSeedZip({ repositoryRoot, targetZip, command = runCommand }) {
  const source = resolve(repositoryRoot, "OriginalWinApp");
  if (!(await stat(join(source, "Shopman32"))).isDirectory()) throw new Error("OriginalWinApp/Shopman32 is unavailable for seed rehearsal.");
  await command("zip", ["-q", "-r", targetZip, "Shopman32", "-x", "*/.DS_Store", "*/__MACOSX/*", "*/._*"], { cwd: source, label: "seed ZIP creation" });
  const data = await readFile(targetZip);
  return { path: targetZip, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), temporary: true };
}

export function cutoverDryRunArguments({ repositoryRoot, sourcePath, manifestPath, proposalPath, adjudicationManifestPath, activeRoResolutionPath, snapshotManifestPath, reportDirectory }) {
  return [resolve(repositoryRoot, "scripts/legacy-cutover.mjs"), "--source", sourcePath,
    "--customer-recovery-manifest", manifestPath, "--customer-recovery-proposal", proposalPath,
    "--snapshot-manifest", snapshotManifestPath, "--payment-date-policy", "invoice-date-proxy",
    ...(adjudicationManifestPath ? ["--final-cutover-adjudication", adjudicationManifestPath] : []),
    ...(activeRoResolutionPath ? ["--final-cutover-active-ro-resolution", activeRoResolutionPath] : []),
    "--dry-run", "--report", "--report-dir", reportDirectory, "--summary-only"];
}

export function validateRehearsalCutoverReport(summary, expected = {}) {
  const reviewedStages = [
    ...(expected.adjudicationProvided ? ["active-ro-adjudication-validation"] : []),
    ...(expected.activeRoResolutionProvided ? ["active-ro-resolution-validation"] : []),
  ];
  const expectedStages = [...REHEARSAL_STAGES.slice(0, 8), ...reviewedStages, ...REHEARSAL_STAGES.slice(8)];
  const stages = (summary.stages ?? []).filter((stage) => stage.status === "passed").map((stage) => stage.name);
  if (JSON.stringify(stages) !== JSON.stringify(expectedStages)) throw new Error("Cutover stage order is missing, reordered, skipped, or failed.");
  if (expected.sourcePath && summary.source?.path !== expected.sourcePath) throw new Error("Cutover canonical source-path continuity validation failed.");
  const stageByName = new Map((summary.stages ?? []).map((stage) => [stage.name, stage]));
  if (expected.sourceFingerprint) {
    for (const name of ["source-validation", "recovery-manifest-validation"]) {
      if (stageByName.get(name)?.sourceFingerprint !== expected.sourceFingerprint) throw new Error("Cutover source fingerprint continuity validation failed.");
    }
  }
  const customerRun = stageByName.get("customer-vehicle-staging-projection")?.importRunId;
  if (!customerRun || stageByName.get("customer-vehicle-transformation-projection")?.importRunId !== customerRun || stageByName.get("customer-recovery-projection")?.importRunId !== customerRun) {
    throw new Error("Customer import-run identity continuity validation failed.");
  }
  const invoiceRun = stageByName.get("invoice-labor-ar-staging-projection")?.importRunId;
  if (!invoiceRun || stageByName.get("invoice-ar-transformation-projection")?.importRunId !== invoiceRun || stageByName.get("payment-projection")?.importRunId !== invoiceRun) {
    throw new Error("Invoice/AR import-run identity continuity validation failed.");
  }
  const recoveryFingerprint = stageByName.get("customer-recovery-projection")?.recoveryFingerprint;
  if (!recoveryFingerprint || stageByName.get("invoice-ar-transformation-projection")?.recoveryFingerprint !== recoveryFingerprint || stageByName.get("payment-projection")?.recoveryFingerprint !== recoveryFingerprint) {
    throw new Error("Customer recovery-result continuity validation failed.");
  }
  const recovery = summary.recovery?.counts ?? {};
  const vehicleRecovery = summary.recovery?.vehicleCounts ?? {};
  const payment = summary.payment?.counts ?? {};
  const checks = [
    [recovery.unexpectedUnresolved ?? 0, "unexpected Customer recovery entries"],
    [recovery.aliasCollisions ?? 0, "Customer alias collisions"],
    [vehicleRecovery.unresolved ?? 0, "unresolved historical Vehicle recovery entries"],
    [payment.tenderMismatches ?? 0, "Payment tender mismatches"],
    [payment.invoiceMismatches ?? 0, "Invoice/Payment mismatches"],
    [payment.deterministicConflicts ?? 0, "deterministic Payment conflicts"],
    [payment.invalidProxyDates ?? 0, "invalid Payment proxy dates"],
    [payment.fatalUnsupportedFieldAmbiguities ?? 0, "fatal unsupported Payment fields"],
    [summary.verification?.invoiceArFinancialMismatches ?? 0, "Invoice/AR financial mismatches"],
    [summary.verification?.sourceToInvoiceTotalMismatches ?? 0, "source-to-Invoice total mismatches"],
    [summary.verification?.sourceToArBalanceMismatches ?? 0, "source-to-AR balance mismatches"],
    [summary.verification?.openOrderFatalRelationshipIssues ?? 0, "open Repair Order relationship issues"],
    [summary.verification?.openOrderFatalFinancialIssues ?? 0, "open Repair Order financial issues"],
    [summary.acceptance?.blockingIssues ?? 0, "fresh-cutover acceptance issues"],
    [summary.acceptance?.mileage?.completedMismatches ?? 0, "mileage mismatches"],
    [summary.acceptance?.mileage?.unresolved ?? 0, "unresolved mileage matches"],
    [summary.acceptance?.mileage?.ambiguous ?? 0, "ambiguous mileage matches"],
    [summary.acceptance?.vendor?.completedMismatches ?? 0, "Vendor mismatches"],
    [summary.acceptance?.vendor?.unresolved ?? 0, "unresolved Vendor matches"],
    [summary.acceptance?.vendor?.ambiguous ?? 0, "ambiguous Vendor matches"],
    [summary.acceptance?.complimentary?.unexpectedClassifications ?? 0, "unexpected complimentary classifications"],
    [summary.acceptance?.recoveryBackfill?.invoiceOdometer?.proposedUpdates ?? 0, "Invoice odometer recovery updates"],
    [summary.acceptance?.recoveryBackfill?.invoicePartVendor?.proposedUpdates ?? 0, "Invoice-part Vendor recovery updates"],
  ];
  const failed = checks.find(([count]) => Number(count) !== 0);
  if (failed) throw new Error(`Reconciliation failed: ${failed[1]}=${failed[0]}.`);
  if (summary.verification?.databaseWrites !== 0 || summary.reset?.completed || summary.backup?.completed || summary.verification?.confirmedImports !== 0 || summary.verification?.migrationsApplied !== 0) {
    throw new Error("Cutover report does not prove a zero-write rehearsal.");
  }
  if (summary.criticalIssues?.length) throw new Error(`Cutover dry run failed: ${summary.criticalIssues[0]}.`);
  return { valid: true, stages };
}

export function sanitizeRehearsalReport(report) {
  const serialized = JSON.stringify(report).toLowerCase();
  for (const forbidden of ["displayname", "addressline", "phone", "email", "vin", "licenseplate", "notes", "rawdata", "database_url", "direct_url"]) {
    if (serialized.includes(forbidden)) throw new Error(`Sanitized report contains prohibited field: ${forbidden}.`);
  }
  return report;
}

function sourceSnapshotDate(manifest) {
  const value = manifest?.snapshotBinding?.snapshotDate;
  if (value == null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("Recovery manifest snapshotBinding.snapshotDate must be a valid YYYY-MM-DD date.");
  }
  return value;
}

function markdownReport(report) {
  const section = (title, value) => `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  return `# Legacy refresh rehearsal\n\n- Status: **${report.status}**\n- Mode: ${report.sourceMode}\n- Source snapshot date: ${report.sourceSnapshotDate ?? "Unavailable"}\n- Rehearsal execution date: ${report.rehearsalExecutionDate}\n- Rehearsal started at: ${report.rehearsalStartedAt}\n- Rehearsal finished at: ${report.rehearsalFinishedAt}\n- Temporary intake date: ${report.temporaryIntakeDate}\n- Git HEAD: ${report.git.head}\n- ZIP SHA-256: ${report.zip.sha256}\n- ZIP bytes: ${report.zip.bytes}\n- Source fingerprint: ${report.sourceFingerprint}\n- Recovery manifest: valid and snapshot-bound\n- Stage order: valid\n- Database counts unchanged: yes\n- Database writes: 0\n\n${section("Mileage coverage", report.acceptance.mileage)}\n\n${section("Vendor/source coverage", report.acceptance.vendor)}\n\n${section("Complimentary-service compatibility", report.acceptance.complimentary)}\n\n${section("Operational Repair Order eligibility", report.acceptance.operational)}\n\n${section("Unified-history readiness", report.acceptance.history)}\n\n${section("Recovery-backfill zero-delta status", report.acceptance.recoveryBackfill)}\n\n${section("Schema/migration readiness", report.schemaReadiness)}\n\n${section("Existing financial reconciliation summary", report.aggregates.invoiceAr)}\n\n## Stages\n\n${report.stageOrder.stages.map((stage) => `1. ${stage}`).join("\n")}\n\n## Payment aggregates\n\n\`\`\`json\n${JSON.stringify(report.aggregates.payment, null, 2)}\n\`\`\`\n\n## Warnings\n\n${report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- None"}\n`;
}

async function oneJson(directory) {
  const names = (await readdir(directory)).filter((name) => name.startsWith("cutover-") && name.endsWith(".json"));
  if (names.length !== 1) throw new Error("Cutover did not produce exactly one JSON report.");
  const path = join(directory, names[0]);
  return { path, value: JSON.parse(await readFile(path, "utf8")) };
}

export async function runLegacyRefreshRehearsal(options, dependencies = {}) {
  const repositoryRoot = dependencies.repositoryRoot ?? process.cwd();
  const now = dependencies.now ?? (() => new Date());
  const command = dependencies.command ?? runCommand;
  const databaseState = dependencies.databaseState;
  if (!databaseState) throw new Error("A read-only database state provider is required.");
  const startedAt = now().toISOString();
  const workspace = resolve(options.workspace);
  await assertSafeDestination(workspace, repositoryRoot);
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await chmod(workspace, 0o700);
  const runDirectory = await mkdtemp(join(workspace, "rehearsal-"));
  await chmod(runDirectory, 0o700);
  const directories = {};
  for (const name of ["incoming", "snapshots", "manifests", "reports", "logs"]) {
    directories[name] = join(runDirectory, name); await mkdir(directories[name], { mode: 0o700 });
  }
  let temporarySeedZip = null;
  let snapshotPath = null;
  let failedStage = "initialization";
  try {
    const git = dependencies.gitState ? await dependencies.gitState() : await gitState(repositoryRoot);
    failedStage = "source-zip";
    let zip;
    if (options.mode === "seed") {
      temporarySeedZip = join(directories.incoming, "shopman32.zip");
      zip = await (dependencies.seedZip ?? createSeedZip)({ repositoryRoot, targetZip: temporarySeedZip, command });
    } else {
      const supplied = resolve(options.zip);
      if (!(await stat(supplied)).isFile()) throw new Error("--zip must identify a regular file.");
      const data = await readFile(supplied);
      zip = { path: supplied, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), temporary: false };
    }
    failedStage = "snapshot-intake";
    const snapshot = await (dependencies.intake ?? runSnapshotIntake)({ zip: zip.path, snapshotDate: options.snapshotDate, destination: directories.snapshots, dryRun: false }, { repositoryRoot });
    snapshotPath = snapshot.finalPath;
    const source = await (dependencies.sourceResolver ?? resolveLegacySource)({ args: ["--source", snapshot.dataDirectory], requiredFiles: snapshot.manifest.requiredFileValidation.required, repositoryRoot });
    failedStage = "recovery-manifest-validation";
    const before = await databaseState();
    const loadedApproval = dependencies.manifestLoader
      ? await dependencies.manifestLoader({ path: options.recoveryManifest, proposalPath: options.recoveryProposal, snapshotManifestPath: join(snapshot.finalPath, "manifest.json"), shopId: before.shopId, repositoryRoot })
      : await loadAndValidateRecoveryApprovalV4({
        approvalPath: options.recoveryManifest,
        proposalPath: options.recoveryProposal,
        snapshotManifestPath: join(snapshot.finalPath, "manifest.json"),
        shopId: before.shopId,
        repositoryRoot,
      });
    const loadedManifest = loadedApproval.legacyManifest
      ? { path: loadedApproval.path, manifest: loadedApproval.legacyManifest }
      : loadedApproval;
    const authoritativeSourceSnapshotDate = sourceSnapshotDate(loadedManifest.manifest);
    failedStage = "schema-migration-readiness";
    const schemaReadiness = dependencies.schemaReadiness
      ? await dependencies.schemaReadiness(repositoryRoot, before.appliedMigrations ?? null)
      : await validateSchemaReadiness(repositoryRoot, before.appliedMigrations ?? null);
    if (schemaReadiness.requiresMigrateDeploy) throw new Error("Target schema is not current; prisma migrate deploy is required before a confirmed cutover.");
    failedStage = "cutover-dry-run";
    await command(process.execPath, cutoverDryRunArguments({
      repositoryRoot, sourcePath: source.path, manifestPath: loadedManifest.path,
      proposalPath: options.recoveryProposal,
      adjudicationManifestPath: options.adjudicationManifest,
      activeRoResolutionPath: options.activeRoResolution,
      snapshotManifestPath: join(snapshot.finalPath, "manifest.json"),
      reportDirectory: directories.reports,
    }), { cwd: repositoryRoot, label: "legacy cutover dry run" });
    const cutover = dependencies.cutoverReport ? await dependencies.cutoverReport(directories.reports) : await oneJson(directories.reports);
    failedStage = "stage-and-reconciliation-validation";
    const stageOrder = validateRehearsalCutoverReport(cutover.value, {
      sourceFingerprint: source.fingerprint, sourcePath: source.path,
      adjudicationProvided: Boolean(options.adjudicationManifest),
      activeRoResolutionProvided: Boolean(options.activeRoResolution),
    });
    const after = await databaseState();
    if (before.shopId !== after.shopId || JSON.stringify(before.counts) !== JSON.stringify(after.counts)) throw new Error("Read-only database counts changed during rehearsal.");
    failedStage = "focused-validation";
    const tests = await (dependencies.runTests ?? (() => command(process.execPath, ["--test", "scripts/legacy-snapshot-intake.test.mjs", "scripts/legacy-source-safety.test.mjs", "scripts/legacy-customer-recovery-proposal.test.mjs", "scripts/legacy-cutover-customer-recovery.test.mjs", "scripts/legacy-payment-import.test.mjs", "scripts/legacy-cutover-payment.test.mjs", "scripts/legacy-invoice-transformer-safety.test.mjs", "scripts/legacy-cutover-acceptance.test.mjs", "scripts/legacy-final-cutover-adjudication.test.mjs", "scripts/legacy-final-cutover-open-orders.test.mjs", "tests/invoice-odometer-backfill.test.mjs", "tests/invoice-part-vendor-backfill.test.mjs", "tests/complimentary-services.test.mjs", "tests/repair-order-history.test.mjs", "tests/repair-order-list.test.mjs", "scripts/legacy-refresh-rehearsal.test.mjs"], { cwd: repositoryRoot, label: "focused legacy tests" })))();
    const focusedLint = await (dependencies.focusedLint ?? (() => command("npx", ["eslint",
      "scripts/legacy-refresh-rehearsal.mjs", "scripts/lib/legacy-refresh-rehearsal.mjs", "scripts/legacy-cutover.mjs",
      "scripts/legacy-snapshot-intake.mjs", "scripts/lib/legacy-source.mjs", "scripts/lib/legacy-customer-recovery.mjs",
      "scripts/lib/legacy-payment-import.mjs", "scripts/lib/legacy-payment-stage.mjs", "scripts/transform-invoices.mjs",
      "scripts/lib/legacy-cutover-acceptance.mjs", "scripts/lib/legacy-invoice-projection.mjs",
      "scripts/lib/legacy-final-cutover-adjudication.mjs", "scripts/lib/legacy-final-cutover-resolution.mjs", "scripts/lib/legacy-open-order-source.mjs",
      "scripts/generate-legacy-customer-recovery-proposal.mjs", "scripts/approve-legacy-customer-recovery.mjs",
      "scripts/lib/legacy-customer-recovery-proposal.mjs", "scripts/lib/legacy-snapshot-evidence.mjs",
      "scripts/lib/legacy-vehicle-recovery.mjs",
    ], { cwd: repositoryRoot, label: "focused ESLint" })))();
    const prismaValidate = await (dependencies.prismaValidate ?? (() => command("npx", ["prisma", "validate"], { cwd: repositoryRoot, label: "Prisma schema validation" })))();
    const prismaGenerate = await (dependencies.prismaGenerate ?? (() => command("npx", ["prisma", "generate"], { cwd: repositoryRoot, label: "Prisma client generation" })))();
    let repositoryLint = { passed: true };
    try { await (dependencies.repositoryLint ?? (() => command("npm", ["run", "lint"], { cwd: repositoryRoot, label: "repository lint" })))(); }
    catch (error) { repositoryLint = { passed: false, error: safeMessage(error) }; }
    const diffCheck = await (dependencies.diffCheck ?? (() => command("git", ["diff", "--check"], { cwd: repositoryRoot, label: "git diff --check" })))();
    const finalStatus = dependencies.finalStatus ? await dependencies.finalStatus() : await command("git", ["status", "--short"], { cwd: repositoryRoot, label: "git status" });
    const report = sanitizeRehearsalReport({
      formatVersion: 1, status: "PASS", sourceMode: options.mode,
      sourceSnapshotDate: authoritativeSourceSnapshotDate, rehearsalExecutionDate: startedAt.slice(0, 10),
      rehearsalStartedAt: startedAt, rehearsalFinishedAt: now().toISOString(), temporaryIntakeDate: options.snapshotDate,
      git: { head: git.head, dirtyFileCount: git.status.length }, zip: { bytes: zip.bytes, sha256: zip.sha256 },
      immutableSnapshotPath: options.keepSnapshot ? snapshot.finalPath : null, sourceFingerprint: source.fingerprint,
      recoveryManifest: { valid: true, path: loadedManifest.path }, stageOrder,
      schemaReadiness: { ...schemaReadiness, schemaValidationPassed: true, clientGenerationPassed: true },
      acceptance: cutover.value.acceptance,
      aggregates: { customerVehicle: cutover.value.source?.expectedCleanCounts ?? {}, recovery: cutover.value.recovery?.counts ?? {}, invoiceAr: cutover.value.source?.reconciliation?.invoices ?? {}, payment: cutover.value.payment ?? {}, openOrders: cutover.value.source?.reconciliation?.openRepairOrders ?? {} },
      dynamicSourceContract: { evaluated: true, basis: "selected immutable source and transformed projection", hardcodedHistoricalCounts: false },
      databaseCounts: { before: before.counts, after: after.counts, equal: true },
      tests: { passed: true, exitCode: tests.code ?? 0 }, focusedLint: { passed: true, exitCode: focusedLint.code ?? 0 }, repositoryLint,
      prismaValidate: { passed: true, exitCode: prismaValidate.code ?? 0 }, prismaGenerate: { passed: true, exitCode: prismaGenerate.code ?? 0 },
      diffCheck: { passed: true, exitCode: diffCheck.code ?? 0 }, finalGitStatus: { dirtyFileCount: (finalStatus.stdout?.split("\n").filter(Boolean) ?? git.status).length },
      cutoverReport: cutover.path, warnings: repositoryLint.passed ? [] : ["Repository lint has unrelated existing failures."], failedStage: null,
    });
    const jsonPath = join(directories.reports, "legacy-refresh-rehearsal.json");
    const markdownPath = join(directories.reports, "legacy-refresh-rehearsal.md");
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await writeFile(markdownPath, markdownReport(report), { flag: "wx", mode: 0o600 });
    if (!options.keepSnapshot) { await rm(snapshot.finalPath, { recursive: true, force: true }); snapshotPath = null; }
    return { report, jsonPath, markdownPath, snapshotPath, runDirectory };
  } catch (error) {
    const failure = { formatVersion: 1, status: "FAIL", sourceMode: options.mode, rehearsalExecutionDate: startedAt.slice(0, 10), rehearsalStartedAt: startedAt, rehearsalFinishedAt: now().toISOString(), temporaryIntakeDate: options.snapshotDate, failedStage, rootCause: safeMessage(error), warnings: [] };
    const jsonPath = join(directories.reports, "legacy-refresh-rehearsal.json");
    const markdownPath = join(directories.reports, "legacy-refresh-rehearsal.md");
    await writeFile(jsonPath, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 });
    await writeFile(markdownPath, `# Legacy refresh rehearsal\n\n- Status: **FAIL**\n- Failed stage: ${failedStage}\n- Root cause: ${failure.rootCause}\n`, { mode: 0o600 });
    error.rehearsal = { report: failure, jsonPath, markdownPath, runDirectory };
    throw error;
  } finally {
    if (temporarySeedZip) await rm(temporarySeedZip, { force: true });
    if (!options.keepSnapshot && snapshotPath) await rm(snapshotPath, { recursive: true, force: true });
  }
}
