import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CUTOVER_RECOVERY_SOURCE_TABLES } from "./lib/legacy-customer-recovery.mjs";
import { inspectZipBuffer } from "./legacy-snapshot-intake.mjs";
import {
  REHEARSAL_STAGES,
  APPROVED_SEED_REHEARSAL_CONTRACT,
  compareApprovedSeedContract,
  createSeedZip,
  cutoverDryRunArguments,
  parseLegacyRefreshRehearsalArguments,
  runLegacyRefreshRehearsal,
  sanitizeRehearsalReport,
  validateRehearsalCutoverReport,
} from "./lib/legacy-refresh-rehearsal.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);

function options(root, mode = "zip") {
  return { mode, zip: mode === "zip" ? join(root, "customer.zip") : undefined, snapshotDate: "2026-07-31", recoveryManifest: join(root, "recovery.json"), workspace: join(root, "workspace"), keepSnapshot: false };
}

function recoveryManifest(overrides = {}) {
  return {
    manifestVersion: "2.0.0",
    sourceBinding: { sourceFingerprint: fingerprint, shopId, sourceTables: [...CUTOVER_RECOVERY_SOURCE_TABLES] },
    expectedCounts: { aliases: 0, recoveredCustomers: 0, unresolved: 0, recoverableOrders: 0 },
    existingCustomerAliases: [], customersToCreate: [], unresolvedOrders: [], ...overrides,
  };
}

function cutoverSummary(overrides = {}) {
  const importRunId = "22222222-2222-4222-8222-222222222222";
  const customerImportRunId = "33333333-3333-4333-8333-333333333333";
  return {
    status: "PASS", stages: REHEARSAL_STAGES.map((name) => ({
      name, status: "passed",
      ...(["source-validation", "recovery-manifest-validation"].includes(name) ? { sourceFingerprint: fingerprint } : {}),
      ...(["invoice-labor-ar-staging-projection", "invoice-ar-transformation-projection", "payment-projection"].includes(name) ? { importRunId } : {}),
      ...(["customer-vehicle-staging-projection", "customer-vehicle-transformation-projection", "customer-recovery-projection"].includes(name) ? { importRunId: customerImportRunId } : {}),
      ...(["customer-recovery-projection", "invoice-labor-ar-staging-projection", "invoice-ar-transformation-projection", "payment-projection"].includes(name) ? { recoveryFingerprint: fingerprint } : {}),
    })),
    recovery: { counts: { unexpectedUnresolved: 0, aliasCollisions: 0 } },
    payment: { counts: { tenderMismatches: 0, invoiceMismatches: 0, deterministicConflicts: 0, invalidProxyDates: 0, fatalUnsupportedFieldAmbiguities: 0 } },
    source: { path: "/snapshot/data", expectedCleanCounts: {}, reconciliation: {} }, verification: { databaseWrites: 0, confirmedImports: 0, migrationsApplied: 0 },
    reset: { completed: false }, backup: { completed: false }, criticalIssues: [], ...overrides,
  };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function harness(mode = "zip", overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "legacy-rehearsal-test-"));
  await writeFile(join(root, "customer.zip"), "customer-supplied-zip");
  await writeFile(join(root, "recovery.json"), "{}");
  let countCalls = 0;
  let cutoverArgs = null;
  let seedZipPath = null;
  const dependencies = {
    repositoryRoot: root,
    privateSeedContractAvailable: false,
    gitState: async () => ({ head: "0123456789abcdef", status: [" M preserved-work"] }),
    seedZip: async ({ targetZip }) => { seedZipPath = targetZip; await writeFile(targetZip, "seed-zip"); return { path: targetZip, bytes: 8, sha256: "b".repeat(64), temporary: true }; },
    intake: async ({ destination }) => {
      const finalPath = join(destination, "2026-07-31-aaaaaaaaaaaa");
      const dataDirectory = join(finalPath, "Shopman32", "data");
      await mkdir(dataDirectory, { recursive: true });
      return { finalPath, dataDirectory, manifest: { requiredFileValidation: { required: ["Cust.DBF"] } } };
    },
    sourceResolver: async () => ({ path: "/snapshot/data", fingerprint, actualFiles: { "Cust.DBF": "Cust.DBF" } }),
    manifestLoader: async ({ path }) => ({ path, manifest: recoveryManifest() }),
    databaseState: async () => { countCalls += 1; return { shopId, counts: { customers: 10, payments: 20 } }; },
    command: async (_command, args) => { cutoverArgs = args; return { code: 0, stdout: "", stderr: "" }; },
    cutoverReport: async () => ({ path: "cutover.json", value: cutoverSummary() }),
    runTests: async () => ({ code: 0 }), focusedLint: async () => ({ code: 0 }), repositoryLint: async () => ({ code: 0 }),
    diffCheck: async () => ({ code: 0 }), finalStatus: async () => ({ code: 0, stdout: " M preserved-work\n" }),
    ...overrides,
  };
  return { root, options: options(root, mode), dependencies, state: () => ({ countCalls, cutoverArgs, seedZipPath }) };
}

test("arguments require one source mode and reject missing, duplicate, unknown, and confirmation arguments", () => {
  const common = ["--snapshot-date", "2026-07-31", "--customer-recovery-manifest", "/safe/recovery.json", "--workspace", "/safe/work"];
  assert.equal(parseLegacyRefreshRehearsalArguments(["--seed", ...common]).mode, "seed");
  assert.equal(parseLegacyRefreshRehearsalArguments(["--zip", "/safe/shopman32.zip", ...common]).mode, "zip");
  assert.throws(() => parseLegacyRefreshRehearsalArguments(common), /Exactly one/);
  assert.throws(() => parseLegacyRefreshRehearsalArguments(["--seed", "--zip", "x", ...common]), /Exactly one/);
  assert.throws(() => parseLegacyRefreshRehearsalArguments(["--seed", ...common, "--workspace", "again"]), /exactly once/);
  assert.throws(() => parseLegacyRefreshRehearsalArguments(["--seed", ...common, "--confirm", "RESET_SHOP_OPERATIONAL_DATA"]), /prohibited/);
  assert.throws(() => parseLegacyRefreshRehearsalArguments(["--seed", ...common, "--write"]), /Unknown/);
});

test("constructed cutover command is unconditionally dry-run and has no confirmation capability", () => {
  const args = cutoverDryRunArguments({ repositoryRoot: "/repo", sourcePath: "/snapshot/data", manifestPath: "/manifest.json", reportDirectory: "/reports" });
  assert.ok(args.includes("--dry-run"));
  assert.ok(args.includes("invoice-date-proxy"));
  assert.ok(!args.includes("--confirm"));
  assert.ok(!args.some((value) => /RESET_SHOP|IMPORT_LEGACY|TRANSFORM_LEGACY/.test(value)));
});

test("ZIP rehearsal retains the customer ZIP, checks counts twice, and removes the snapshot by default", async () => {
  const item = await harness("zip");
  try {
    const result = await runLegacyRefreshRehearsal(item.options, item.dependencies);
    assert.equal(item.state().countCalls, 2);
    assert.equal(await readFile(item.options.zip, "utf8"), "customer-supplied-zip");
    assert.equal(await exists(join(item.options.workspace, "snapshots", "2026-07-31-aaaaaaaaaaaa")), false);
    assert.equal(result.report.databaseCounts.equal, true);
    assert.ok(item.state().cutoverArgs.includes("--dry-run"));
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("--keep-snapshot retains the immutable accepted snapshot", async () => {
  const item = await harness("zip");
  item.options.keepSnapshot = true;
  try {
    const result = await runLegacyRefreshRehearsal(item.options, item.dependencies);
    assert.ok(result.snapshotPath);
    assert.equal((await stat(result.snapshotPath)).isDirectory(), true);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("seed mode creates and always removes its temporary ZIP after success", async () => {
  const item = await harness("seed");
  try {
    await runLegacyRefreshRehearsal(item.options, item.dependencies);
    assert.ok(item.state().seedZipPath);
    assert.equal(await exists(item.state().seedZipPath), false);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("seed ZIP creation preserves Shopman32 structure and excludes macOS metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "legacy-rehearsal-seed-"));
  try {
    await mkdir(join(root, "OriginalWinApp", "Shopman32", "data"), { recursive: true });
    await writeFile(join(root, "OriginalWinApp", "Shopman32", "data", "Cust.DBF"), "fixture");
    await writeFile(join(root, "OriginalWinApp", "Shopman32", ".DS_Store"), "metadata");
    const targetZip = join(root, "seed.zip");
    const result = await createSeedZip({ repositoryRoot: root, targetZip });
    const entries = inspectZipBuffer(await readFile(targetZip)).entries.map((entry) => entry.path);
    assert.ok(entries.includes("Shopman32/data/Cust.DBF"));
    assert.ok(!entries.some((entry) => entry.includes(".DS_Store")));
    assert.equal(result.temporary, true);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("intake failure stops rehearsal and removes a temporary seed ZIP", async () => {
  const item = await harness("seed", { intake: async () => { throw new Error("synthetic intake failure"); } });
  try {
    await assert.rejects(runLegacyRefreshRehearsal(item.options, item.dependencies), /synthetic intake failure/);
    assert.equal(await exists(item.state().seedZipPath), false);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("a customer-supplied ZIP is never removed when rehearsal fails", async () => {
  const item = await harness("zip", { intake: async () => { throw new Error("synthetic intake failure"); } });
  try {
    await assert.rejects(runLegacyRefreshRehearsal(item.options, item.dependencies), /synthetic intake failure/);
    assert.equal(await readFile(item.options.zip, "utf8"), "customer-supplied-zip");
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("stale source fingerprint and wrong shop manifests stop before cutover", async () => {
  for (const binding of [{ sourceFingerprint: "c".repeat(64), shopId }, { sourceFingerprint: fingerprint, shopId: "22222222-2222-4222-8222-222222222222" }]) {
    let commands = 0;
    const item = await harness("zip", { manifestLoader: async ({ path }) => ({ path, manifest: recoveryManifest({ sourceBinding: { ...binding, sourceTables: [...CUTOVER_RECOVERY_SOURCE_TABLES] } }) }), command: async () => { commands += 1; } });
    try {
      await assert.rejects(runLegacyRefreshRehearsal(item.options, item.dependencies), /manifest binding failed/);
      assert.equal(commands, 0);
    } finally { await rm(item.root, { recursive: true, force: true }); }
  }
});

test("cutover failure, stage order failure, and reconciliation failure are fatal", async () => {
  const cases = [
    { dependencies: { command: async () => { throw new Error("cutover stopped"); } }, pattern: /cutover stopped/ },
    { dependencies: { cutoverReport: async () => ({ path: "x", value: cutoverSummary({ stages: [] }) }) }, pattern: /stage order/ },
    { dependencies: { cutoverReport: async () => ({ path: "x", value: cutoverSummary({ payment: { counts: { tenderMismatches: 1 } } }) }) }, pattern: /Reconciliation failed/ },
  ];
  for (const entry of cases) {
    const item = await harness("zip", entry.dependencies);
    try { await assert.rejects(runLegacyRefreshRehearsal(item.options, item.dependencies), entry.pattern); }
    finally { await rm(item.root, { recursive: true, force: true }); }
  }
});

test("before and after database count differences fail the rehearsal", async () => {
  let calls = 0;
  const item = await harness("zip", { databaseState: async () => ({ shopId, counts: { customers: calls++ } }) });
  try { await assert.rejects(runLegacyRefreshRehearsal(item.options, item.dependencies), /counts changed/); }
  finally { await rm(item.root, { recursive: true, force: true }); }
});

test("sanitized reports reject private source field names", () => {
  assert.throws(() => sanitizeRehearsalReport({ rawData: { name: "private" } }), /prohibited/);
  assert.throws(() => sanitizeRehearsalReport({ VIN: "private" }), /prohibited/);
  assert.deepEqual(sanitizeRehearsalReport({ counts: { customers: 1 } }), { counts: { customers: 1 } });
});

test("valid report requires the exact ordered stage ledger and zero-write proof", () => {
  assert.equal(validateRehearsalCutoverReport(cutoverSummary()).valid, true);
  assert.throws(() => validateRehearsalCutoverReport(cutoverSummary({ verification: { databaseWrites: 1, confirmedImports: 0, migrationsApplied: 0 } })), /zero-write/);
});

test("private seed aggregate expectations are fixed and mismatches fail comparison", () => {
  assert.equal(compareApprovedSeedContract({ ...APPROVED_SEED_REHEARSAL_CONTRACT }).passed, true);
  const mismatch = compareApprovedSeedContract({ ...APPROVED_SEED_REHEARSAL_CONTRACT, proposedPaymentRows: 1 });
  assert.equal(mismatch.passed, false);
  assert.deepEqual(mismatch.mismatches[0], { key: "proposedPaymentRows", expected: 11_825, actual: 1 });
});
