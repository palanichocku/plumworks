import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CUTOVER_RECOVERY_SOURCE_TABLES, validateCutoverRecoveryManifestBinding } from "./lib/legacy-customer-recovery.mjs";
import {
  buildRecoveryManifestV2,
  parseRecoveryUpgradeArguments,
  runRecoveryUpgrade,
  validateLegacyRecoveryV1,
  validateSnapshotManifestForRecovery,
} from "./lib/legacy-recovery-upgrade.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const fingerprint = "a".repeat(64);

function v1() {
  const aliases = Array.from({ length: 6 }, (_, index) => ({
    legacyCustomerId: `ALIAS-${index}`, existingCustomerId: `old-id-${index}`, existingCustomerLegacyId: `NORMAL-${index}`,
    normalizedName: `NORMAL CUSTOMER ${index}`, normalizedAddress: `${index} MAIN ST`, matchingMethod: "exact-normalized-name-address",
    confidence: "deterministic", reviewStatus: "approved", notes: "approved synthetic evidence", applicableLegacyOrderNumbers: [`A-${index}`],
  }));
  const customers = Array.from({ length: 12 }, (_, index) => ({
    legacyCustomerId: `RECOVERED-${index}`, displayName: `RECOVERED CUSTOMER ${index}`, classification: "historical-unknown",
    reviewStatus: "approved", notes: "approved synthetic evidence", phone: null, alternatePhone: null, address: null,
    city: null, state: null, postalCode: null, associatedLegacyVehicleIds: [],
    applicableLegacyOrderNumbers: index === 0 ? Array.from({ length: 48 }, (_, order) => `R-${order}`) : [`R-${47 + index}`], sourceEvidence: {},
  }));
  return {
    manifestVersion: "1.0.0", clientSlug: "cardoc", generatedAt: "2026-07-01T00:00:00.000Z", sourceDescription: "synthetic",
    existingCustomerAliases: aliases, customersToCreate: customers,
    unresolvedOrders: [{ legacyOrderNumber: "U-1", legacyCustomerId: "UNRESOLVED", total: "0.00", reason: "insufficient evidence", disposition: "keep-skipped", reviewStatus: "approved-skip" }],
  };
}

function snapshot() {
  return {
    manifest: { snapshotDate: "2026-07-11", zipSha256: "b".repeat(64), detectedApplicationRoot: "Shopman32", detectedDataDirectory: "Shopman32/data" },
    sourceFingerprint: fingerprint,
  };
}

function evidence(manifest = v1()) {
  const stagedCustomers = manifest.existingCustomerAliases.map((entry, index) => ({
    id: `projected-normal:${entry.existingCustomerLegacyId}`, legacyCustno: entry.existingCustomerLegacyId,
    displayName: `NORMAL CUSTOMER ${index}`, addressLine1: `${index} MAIN ST`, phone: null, phone2: null,
  }));
  const sourceInvoiceArReferences = [
    ...manifest.existingCustomerAliases.flatMap((entry) => entry.applicableLegacyOrderNumbers.map((legacyRoNo) => ({ legacyRoNo, legacyCustno: entry.legacyCustomerId, total: "1.00", sourceTable: "ar.DBF" }))),
    ...manifest.customersToCreate.flatMap((entry) => entry.applicableLegacyOrderNumbers.map((legacyRoNo) => ({ legacyRoNo, legacyCustno: entry.legacyCustomerId, total: "1.00", sourceTable: "ar.DBF" }))),
    ...manifest.unresolvedOrders.map((entry) => ({ legacyRoNo: entry.legacyOrderNumber, legacyCustno: entry.legacyCustomerId, total: entry.total, sourceTable: "ar.DBF" })),
  ];
  return { stagedCustomers, stagedVehicles: [], sourceCustomerReferences: stagedCustomers, sourceInvoiceArReferences };
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "recovery-upgrade-test-"));
  const input = join(root, "v1.json"), snapshotManifest = join(root, "manifest.json"), output = join(root, "v2.json");
  const manifest = overrides.manifest ?? v1();
  await writeFile(input, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(snapshotManifest, JSON.stringify({ formatVersion: 1 }));
  return { root, input, snapshotManifest, output, manifest };
}

function dependencies(manifest, overrides = {}) {
  return {
    snapshotValidator: async () => snapshot(), evidenceLoader: async () => evidence(manifest),
    now: () => new Date("2026-07-27T00:00:00.000Z"), ...overrides,
  };
}

test("arguments default to dry run and require exact confirmation for one output write", () => {
  const base = ["--input", "v1.json", "--snapshot-manifest", "manifest.json", "--shop-id", shopId, "--output", "v2.json"];
  assert.equal(parseRecoveryUpgradeArguments(base).dryRun, true);
  assert.equal(parseRecoveryUpgradeArguments([...base, "--confirm", "WRITE_RECOVERY_MANIFEST_V2"]).confirmedWrite, true);
  assert.throws(() => parseRecoveryUpgradeArguments([...base, "--confirm", "WRONG"]), /must equal/);
  assert.throws(() => parseRecoveryUpgradeArguments([...base, "--dry-run", "--confirm", "WRITE_RECOVERY_MANIFEST_V2"]), /cannot be combined/);
});

test("valid v1 upgrades to v2 without changing any recovery decision", async () => {
  const item = await fixture();
  try {
    const originalBytes = await readFile(item.input);
    const result = await runRecoveryUpgrade({ input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: true, confirmedWrite: false }, dependencies(item.manifest));
    assert.equal(result.proposal.manifestVersion, "2.0.0");
    assert.deepEqual(result.proposal.existingCustomerAliases, item.manifest.existingCustomerAliases);
    assert.deepEqual(result.proposal.customersToCreate, item.manifest.customersToCreate);
    assert.deepEqual(result.proposal.unresolvedOrders, item.manifest.unresolvedOrders);
    assert.equal(result.proposal.sourceBinding.sourceFingerprint, fingerprint);
    assert.equal(result.proposal.sourceBinding.shopId, shopId);
    assert.deepEqual(result.proposal.sourceBinding.sourceTables, [...CUTOVER_RECOVERY_SOURCE_TABLES]);
    assert.deepEqual(result.proposal.expectedCounts, { aliases: 6, recoveredCustomers: 12, unresolved: 1, recoverableOrders: 65 });
    assert.equal(validateCutoverRecoveryManifestBinding({ manifest: result.proposal, shopId, sourceFingerprint: fingerprint }).length, 0);
    assert.deepEqual(await readFile(item.input), originalBytes);
    await assert.rejects(readFile(item.output), /ENOENT/);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("counts are calculated from preserved entries rather than accepted from input", () => {
  const input = { ...v1(), expectedCounts: { aliases: 999, recoveredCustomers: 999, unresolved: 999, recoverableOrders: 999 } };
  const proposal = buildRecoveryManifestV2({ inputManifest: input, inputSha256: "c".repeat(64), snapshot: snapshot(), shopId, createdAt: "2026-07-27T00:00:00.000Z" });
  assert.deepEqual(proposal.expectedCounts, { aliases: 6, recoveredCustomers: 12, unresolved: 1, recoverableOrders: 65 });
});

test("stale source evidence, wrong shop binding, and malformed v1 fail", async () => {
  const item = await fixture();
  try {
    await assert.rejects(runRecoveryUpgrade({ input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: true, confirmedWrite: false }, dependencies(item.manifest, {
      evidenceLoader: async () => ({ ...evidence(item.manifest), sourceInvoiceArReferences: [] }),
    })), /human review/);
    const malformed = { ...item.manifest, manifestVersion: "bad" };
    await writeFile(item.input, JSON.stringify(malformed));
    await assert.rejects(runRecoveryUpgrade({ input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: true, confirmedWrite: false }, dependencies(malformed)), /wrong-v1-format-version/);
    const proposal = buildRecoveryManifestV2({ inputManifest: item.manifest, inputSha256: "c".repeat(64), snapshot: snapshot(), shopId, createdAt: "2026-07-27T00:00:00.000Z" });
    assert.ok(validateCutoverRecoveryManifestBinding({ manifest: proposal, shopId: "22222222-2222-4222-8222-222222222222", sourceFingerprint: fingerprint }).some((issue) => issue.code === "wrong-shop-binding"));
    const wrongShopInput = { ...item.manifest, shopId: "22222222-2222-4222-8222-222222222222" };
    await writeFile(item.input, JSON.stringify(wrongShopInput));
    await assert.rejects(runRecoveryUpgrade({ input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: true, confirmedWrite: false }, dependencies(wrongShopInput)), /shop identity conflicts/);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("malformed snapshot manifest is rejected by the real snapshot validator", async () => {
  const item = await fixture();
  try { await assert.rejects(validateSnapshotManifestForRecovery({ manifestPath: item.snapshotManifest, repositoryRoot: item.root }), /incomplete or invalid/); }
  finally { await rm(item.root, { recursive: true, force: true }); }
});

test("confirmed creation writes exactly one validated file and refuses collisions", async () => {
  const item = await fixture();
  try {
    const options = { input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: false, confirmedWrite: true };
    const result = await runRecoveryUpgrade(options, dependencies(item.manifest));
    assert.equal(result.summary.outputFileWritesPerformed, 1);
    const written = JSON.parse(await readFile(item.output, "utf8"));
    assert.equal(validateCutoverRecoveryManifestBinding({ manifest: written, shopId, sourceFingerprint: fingerprint }).length, 0);
    await assert.rejects(runRecoveryUpgrade(options, dependencies(item.manifest)), /already exists/);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("non-sensitive summary contains aggregates but no recovery content", async () => {
  const item = await fixture();
  try {
    const result = await runRecoveryUpgrade({ input: item.input, snapshotManifest: item.snapshotManifest, shopId, output: item.output, dryRun: true, confirmedWrite: false }, dependencies(item.manifest));
    const output = JSON.stringify(result.summary);
    assert.doesNotMatch(output, /NORMAL CUSTOMER|MAIN ST|approved synthetic evidence|RECOVERED CUSTOMER/);
    assert.equal(result.summary.fatalIssues, 0);
    assert.equal(result.summary.staleEntries, 0);
    assert.equal(result.summary.collisions, 0);
  } finally { await rm(item.root, { recursive: true, force: true }); }
});

test("legacy v1 validator rejects duplicate identities and preserves supported shape", () => {
  assert.deepEqual(validateLegacyRecoveryV1(v1()), []);
  const duplicate = v1();
  duplicate.customersToCreate[0].legacyCustomerId = duplicate.existingCustomerAliases[0].legacyCustomerId;
  assert.ok(validateLegacyRecoveryV1(duplicate).some((issue) => issue.code === "duplicate-v1-recovery-identity"));
});
