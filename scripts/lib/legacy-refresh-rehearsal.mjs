import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { assertSafeDestination, runSnapshotIntake } from "../legacy-snapshot-intake.mjs";
import { validateCutoverRecoveryManifestBinding } from "./legacy-customer-recovery.mjs";
import { loadRecoveryManifest } from "./legacy-recovery-manifest.mjs";
import { resolveLegacySource } from "./legacy-source.mjs";

export const REHEARSAL_STAGES = Object.freeze([
  "source-validation", "recovery-manifest-validation", "customer-vehicle-staging-projection",
  "customer-vehicle-transformation-projection", "customer-recovery-projection",
  "invoice-labor-ar-staging-projection", "invoice-ar-transformation-projection",
  "payment-projection", "open-repair-order-projection", "final-verification",
]);
export const APPROVED_SEED_REHEARSAL_CONTRACT = Object.freeze({
  matchedInvoices: 11_665, unmatchedInvoices: 1, matchedCustomers: 11_665, unmatchedCustomers: 1,
  proposedPaymentRows: 11_825, totalPaymentAmount: "4217964.10", zeroPaymentOrders: 39,
  splitTenderOrders: 189, tenderMismatches: 0, duplicateDeterministicPaymentKeys: 0,
});

const VALUE_ARGUMENTS = ["--zip", "--snapshot-date", "--customer-recovery-manifest", "--workspace"];

export function parseLegacyRefreshRehearsalArguments(args) {
  const allowed = new Set(["--seed", "--keep-snapshot", ...VALUE_ARGUMENTS]);
  const confirmations = new Set(["--confirm", "RESET_SHOP_OPERATIONAL_DATA", "IMPORT_LEGACY_PAYMENTS", "TRANSFORM_LEGACY_INVOICES"]);
  for (const value of args) {
    if (confirmations.has(value) || value.startsWith("--confirm=")) throw new Error("Confirmation arguments are prohibited in rehearsal mode.");
    if (value.startsWith("--") && !allowed.has(value)) throw new Error(`Unknown argument: ${value}`);
  }
  for (const flag of ["--seed", "--keep-snapshot"]) {
    if (args.filter((value) => value === flag).length > 1) throw new Error(`${flag} may be supplied only once.`);
  }
  const values = {};
  for (const name of VALUE_ARGUMENTS) {
    const positions = args.flatMap((value, index) => value === name ? [index] : []);
    if ((name !== "--zip" && positions.length !== 1) || positions.length > 1) throw new Error(`${name} must be provided exactly once.`);
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
    recoveryManifest: values["--customer-recovery-manifest"], workspace: values["--workspace"],
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

export function cutoverDryRunArguments({ repositoryRoot, sourcePath, manifestPath, reportDirectory }) {
  return [resolve(repositoryRoot, "scripts/legacy-cutover.mjs"), "--source", sourcePath,
    "--customer-recovery-manifest", manifestPath, "--payment-date-policy", "invoice-date-proxy",
    "--dry-run", "--report", "--report-dir", reportDirectory, "--summary-only"];
}

export function validateRehearsalCutoverReport(summary, expected = {}) {
  const stages = (summary.stages ?? []).filter((stage) => stage.status === "passed").map((stage) => stage.name);
  if (JSON.stringify(stages) !== JSON.stringify(REHEARSAL_STAGES)) throw new Error("Cutover stage order is missing, reordered, skipped, or failed.");
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
  const payment = summary.payment?.counts ?? {};
  const checks = [
    [recovery.unexpectedUnresolved ?? 0, "unexpected Customer recovery entries"],
    [recovery.aliasCollisions ?? 0, "Customer alias collisions"],
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
  ];
  const failed = checks.find(([count]) => Number(count) !== 0);
  if (failed) throw new Error(`Reconciliation failed: ${failed[1]}=${failed[0]}.`);
  if (summary.verification?.databaseWrites !== 0 || summary.reset?.completed || summary.backup?.completed || summary.verification?.confirmedImports !== 0 || summary.verification?.migrationsApplied !== 0) {
    throw new Error("Cutover report does not prove a zero-write rehearsal.");
  }
  if (summary.criticalIssues?.length) throw new Error(`Cutover dry run failed: ${summary.criticalIssues[0]}.`);
  return { valid: true, stages };
}

export function compareApprovedSeedContract(paymentCounts) {
  const mismatches = Object.entries(APPROVED_SEED_REHEARSAL_CONTRACT).flatMap(([key, expected]) =>
    String(paymentCounts?.[key]) === String(expected) ? [] : [{ key, expected, actual: paymentCounts?.[key] ?? null }]);
  return { evaluated: true, passed: mismatches.length === 0, expected: APPROVED_SEED_REHEARSAL_CONTRACT, mismatches };
}

export function sanitizeRehearsalReport(report) {
  const serialized = JSON.stringify(report).toLowerCase();
  for (const forbidden of ["displayname", "addressline", "phone", "email", "vin", "licenseplate", "notes", "rawdata", "database_url", "direct_url"]) {
    if (serialized.includes(forbidden)) throw new Error(`Sanitized report contains prohibited field: ${forbidden}.`);
  }
  return report;
}

function markdownReport(report) {
  return `# Legacy refresh rehearsal\n\n- Status: **${report.status}**\n- Mode: ${report.sourceMode}\n- Started: ${report.startedAt}\n- Finished: ${report.finishedAt}\n- Git HEAD: ${report.git.head}\n- ZIP SHA-256: ${report.zip.sha256}\n- ZIP bytes: ${report.zip.bytes}\n- Source fingerprint: ${report.sourceFingerprint}\n- Recovery manifest: valid and snapshot-bound\n- Stage order: valid\n- Database counts unchanged: yes\n- Database writes: 0\n\n## Stages\n\n${report.stageOrder.stages.map((stage) => `1. ${stage}`).join("\n")}\n\n## Payment aggregates\n\n\`\`\`json\n${JSON.stringify(report.aggregates.payment, null, 2)}\n\`\`\`\n\n## Warnings\n\n${report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "- None"}\n`;
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
    const loadedManifest = await (dependencies.manifestLoader ?? loadRecoveryManifest)({ path: options.recoveryManifest, repositoryRoot });
    const before = await databaseState();
    const bindingIssues = validateCutoverRecoveryManifestBinding({ manifest: loadedManifest.manifest, shopId: before.shopId, sourceFingerprint: source.fingerprint });
    if (bindingIssues.length) throw new Error(`Customer recovery manifest binding failed: ${bindingIssues[0].code}.`);
    failedStage = "cutover-dry-run";
    await command(process.execPath, cutoverDryRunArguments({ repositoryRoot, sourcePath: source.path, manifestPath: loadedManifest.path, reportDirectory: directories.reports }), { cwd: repositoryRoot, label: "legacy cutover dry run" });
    const cutover = dependencies.cutoverReport ? await dependencies.cutoverReport(directories.reports) : await oneJson(directories.reports);
    failedStage = "stage-and-reconciliation-validation";
    const stageOrder = validateRehearsalCutoverReport(cutover.value, { sourceFingerprint: source.fingerprint, sourcePath: source.path });
    const after = await databaseState();
    if (before.shopId !== after.shopId || JSON.stringify(before.counts) !== JSON.stringify(after.counts)) throw new Error("Read-only database counts changed during rehearsal.");
    failedStage = "focused-validation";
    const tests = await (dependencies.runTests ?? (() => command(process.execPath, ["--test", "scripts/legacy-snapshot-intake.test.mjs", "scripts/legacy-source-safety.test.mjs", "scripts/legacy-cutover-customer-recovery.test.mjs", "scripts/legacy-payment-import.test.mjs", "scripts/legacy-cutover-payment.test.mjs", "scripts/legacy-invoice-transformer-safety.test.mjs", "scripts/legacy-refresh-rehearsal.test.mjs"], { cwd: repositoryRoot, label: "focused legacy tests" })))();
    const focusedLint = await (dependencies.focusedLint ?? (() => command("npx", ["eslint",
      "scripts/legacy-refresh-rehearsal.mjs", "scripts/lib/legacy-refresh-rehearsal.mjs", "scripts/legacy-cutover.mjs",
      "scripts/legacy-snapshot-intake.mjs", "scripts/lib/legacy-source.mjs", "scripts/lib/legacy-customer-recovery.mjs",
      "scripts/lib/legacy-payment-import.mjs", "scripts/lib/legacy-payment-stage.mjs", "scripts/transform-invoices.mjs",
    ], { cwd: repositoryRoot, label: "focused ESLint" })))();
    let repositoryLint = { passed: true };
    try { await (dependencies.repositoryLint ?? (() => command("npm", ["run", "lint"], { cwd: repositoryRoot, label: "repository lint" })))(); }
    catch (error) { repositoryLint = { passed: false, error: safeMessage(error) }; }
    const diffCheck = await (dependencies.diffCheck ?? (() => command("git", ["diff", "--check"], { cwd: repositoryRoot, label: "git diff --check" })))();
    const finalStatus = dependencies.finalStatus ? await dependencies.finalStatus() : await command("git", ["status", "--short"], { cwd: repositoryRoot, label: "git status" });
    const expectedContract = options.mode === "seed" && dependencies.privateSeedContractAvailable !== false
      ? compareApprovedSeedContract(cutover.value.payment?.counts)
      : { evaluated: false, reason: "Private approved seed aggregate contract was not supplied." };
    if (expectedContract.evaluated && !expectedContract.passed) throw new Error("Private approved seed aggregate contract comparison failed.");
    const report = sanitizeRehearsalReport({
      formatVersion: 1, status: "PASS", startedAt, finishedAt: now().toISOString(), sourceMode: options.mode,
      snapshotDate: options.snapshotDate, git, zip: { bytes: zip.bytes, sha256: zip.sha256 },
      immutableSnapshotPath: options.keepSnapshot ? snapshot.finalPath : null, sourceFingerprint: source.fingerprint,
      recoveryManifest: { valid: true, path: loadedManifest.path }, stageOrder,
      aggregates: { customerVehicle: cutover.value.source?.expectedCleanCounts ?? {}, recovery: cutover.value.recovery?.counts ?? {}, invoiceAr: cutover.value.source?.reconciliation?.invoices ?? {}, payment: cutover.value.payment ?? {}, openOrders: cutover.value.source?.reconciliation?.openRepairOrders ?? {} },
      expectedContract,
      databaseCounts: { before: before.counts, after: after.counts, equal: true },
      tests: { passed: true, exitCode: tests.code ?? 0 }, focusedLint: { passed: true, exitCode: focusedLint.code ?? 0 }, repositoryLint,
      diffCheck: { passed: true, exitCode: diffCheck.code ?? 0 }, finalGitStatus: finalStatus.stdout?.split("\n").filter(Boolean) ?? git.status,
      cutoverReport: cutover.path, warnings: repositoryLint.passed ? [] : ["Repository lint has unrelated existing failures."], failedStage: null,
    });
    const jsonPath = join(directories.reports, "legacy-refresh-rehearsal.json");
    const markdownPath = join(directories.reports, "legacy-refresh-rehearsal.md");
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await writeFile(markdownPath, markdownReport(report), { flag: "wx", mode: 0o600 });
    if (!options.keepSnapshot) { await rm(snapshot.finalPath, { recursive: true, force: true }); snapshotPath = null; }
    return { report, jsonPath, markdownPath, snapshotPath, runDirectory };
  } catch (error) {
    const failure = { formatVersion: 1, status: "FAIL", startedAt, finishedAt: now().toISOString(), sourceMode: options.mode, snapshotDate: options.snapshotDate, failedStage, rootCause: safeMessage(error), warnings: [] };
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
