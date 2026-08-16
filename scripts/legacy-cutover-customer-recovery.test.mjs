import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  APPROVED_SEED_RECOVERY_AGGREGATE,
  CUTOVER_RECOVERY_SOURCE_TABLES,
  deterministicRecoveredCustomerId,
  executeCutoverCustomerRecovery,
  planCutoverCustomerRecovery,
  runRecoveryBeforeLaterStages,
} from "./lib/legacy-customer-recovery.mjs";
import { loadRecoveryManifest, recoveryManifestArgument, recoveryProposalArgument } from "./lib/legacy-recovery-manifest.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const importRunId = "22222222-2222-4222-8222-222222222222";
const fingerprint = "a".repeat(64);
const normalCustomer = {
  id: "33333333-3333-4333-8333-333333333333",
  legacyCustno: "PRIMARY",
  displayName: "EXAMPLE CUSTOMER",
  addressLine1: "123 MAIN ST.",
  phone: null,
  phone2: null,
};

function manifest(overrides = {}) {
  return {
    manifestVersion: "2.0.0",
    sourceBinding: { sourceFingerprint: fingerprint, shopId, sourceTables: [...CUTOVER_RECOVERY_SOURCE_TABLES] },
    expectedCounts: { aliases: 1, recoveredCustomers: 1, unresolved: 1, recoverableOrders: 2 },
    existingCustomerAliases: [{
      legacyCustomerId: "ALIAS", existingCustomerId: "old-pre-reset-id", existingCustomerLegacyId: "PRIMARY",
      normalizedName: "EXAMPLE CUSTOMER", normalizedAddress: "123 MAIN ST",
      matchingMethod: "exact-normalized-name-address", confidence: "deterministic", reviewStatus: "approved",
      notes: "approved synthetic evidence", applicableLegacyOrderNumbers: ["2"],
    }],
    customersToCreate: [{
      legacyCustomerId: "RECOVERED", displayName: "HISTORICAL CUSTOMER", classification: "historical-unknown",
      reviewStatus: "approved", notes: "approved synthetic evidence", phone: null, alternatePhone: null,
      address: null, city: null, state: null, postalCode: null, associatedLegacyVehicleIds: [],
      applicableLegacyOrderNumbers: ["3"], sourceEvidence: {},
    }],
    unresolvedOrders: [{
      legacyOrderNumber: "4", legacyCustomerId: "UNRESOLVED", total: "0.00", reason: "insufficient source evidence",
      disposition: "keep-skipped", reviewStatus: "approved-skip",
    }],
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planCutoverCustomerRecovery({
    stagedCustomers: [normalCustomer],
    stagedVehicles: [],
    sourceCustomerReferences: [{ legacyCustno: "PRIMARY" }],
    sourceInvoiceArReferences: [
      { legacyRoNo: "1", legacyCustno: "PRIMARY", total: "10.00" },
      { legacyRoNo: "2", legacyCustno: "ALIAS", total: "20.00" },
      { legacyRoNo: "3", legacyCustno: "RECOVERED", total: "30.00" },
      { legacyRoNo: "4", legacyCustno: "UNRESOLVED", total: "0" },
    ],
    manifest: manifest(), existingAliases: [], shopId, importRunId, sourceFingerprint: fingerprint,
    ...overrides,
  });
}

test("manifest argument is explicit and duplicates are rejected", () => {
  assert.throws(() => recoveryManifestArgument([], { required: true }), /is required/);
  assert.equal(recoveryManifestArgument([], { required: false }), null);
  assert.equal(recoveryManifestArgument(["--customer-recovery-manifest", "/safe/recovery.json"]), "/safe/recovery.json");
  assert.throws(() => recoveryManifestArgument(["--customer-recovery-manifest", "one", "--customer-recovery-manifest", "two"]), /more than once/);
  assert.equal(recoveryProposalArgument([], { required: false }), null);
  assert.throws(() => recoveryProposalArgument([], { required: true }), /is required/);
  assert.equal(recoveryProposalArgument(["--customer-recovery-proposal", "/safe/proposal.json"]), "/safe/proposal.json");
});

test("manifest loader rejects malformed files, directories, and OriginalWinApp aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "plumworks-recovery-"));
  try {
    const original = join(root, "OriginalWinApp");
    await mkdir(original);
    const malformed = join(root, "malformed.json");
    await writeFile(malformed, "not-json");
    await assert.rejects(loadRecoveryManifest({ path: malformed, repositoryRoot: root }), /not valid JSON/);
    await assert.rejects(loadRecoveryManifest({ path: root, repositoryRoot: root }), /regular file/);
    const protectedManifest = join(original, "recovery.json");
    await writeFile(protectedManifest, "{}");
    await assert.rejects(loadRecoveryManifest({ path: protectedManifest, repositoryRoot: root }), /inside OriginalWinApp/);
    const linked = join(root, "linked.json");
    await symlink(protectedManifest, linked);
    await assert.rejects(loadRecoveryManifest({ path: linked, repositoryRoot: root }), /inside OriginalWinApp/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("valid source-bound recovery plans deterministic Customers, aliases, and approved unresolved entries", () => {
  const result = plan();
  assert.deepEqual(result.fatalIssues, []);
  assert.equal(result.customersToCreate.length, 1);
  assert.equal(result.customersToCreate[0].id, deterministicRecoveredCustomerId(shopId, "RECOVERED"));
  assert.equal(result.aliasesToCreate[0].customerId, normalCustomer.id);
  assert.equal(result.unresolvedEntries.length, 1);
  assert.equal(result.unexpectedUnresolved.length, 0);
  assert.deepEqual(result.counts, {
    normalCustomers: 1, recoveredCustomers: 1, aliases: 1, satisfiedRecoveryEntries: 0,
    approvedUnresolved: 1, unexpectedUnresolved: 0, aliasCollisions: 0,
    finalToArCustomerReferenceDifferences: 0, finalOnlyConflictingReferencesIgnored: 0,
    authoritativeArConflicts: 0, fallbackResolutions: 4,
    invoiceReferencesResolvedExact: 1, invoiceReferencesResolvedAlias: 1,
    invoiceReferencesResolvedRecovered: 1, remainingUnmatchedReferences: 1,
  });
});

test("stale fingerprint, wrong shop, and malformed manifest bindings are fatal", () => {
  assert.ok(plan({ sourceFingerprint: "b".repeat(64) }).fatalIssues.some((issue) => issue.code === "stale-source-fingerprint"));
  assert.ok(plan({ shopId: "99999999-9999-4999-8999-999999999999" }).fatalIssues.some((issue) => issue.code === "wrong-shop-binding"));
  assert.ok(plan({ manifest: { manifestVersion: "2.0.0" } }).fatalIssues.some((issue) => issue.code === "missing-source-binding"));
});

test("duplicate aliases, conflicting targets, and normal Customer collisions are fatal", () => {
  const duplicateManifest = manifest();
  duplicateManifest.existingCustomerAliases.push({ ...duplicateManifest.existingCustomerAliases[0], existingCustomerLegacyId: "OTHER" });
  duplicateManifest.expectedCounts.aliases = 2;
  assert.ok(plan({ manifest: duplicateManifest }).fatalIssues.some((issue) => issue.code === "recovery-collision"));
  assert.ok(plan({ stagedCustomers: [normalCustomer, { ...normalCustomer, id: "other", legacyCustno: "RECOVERED" }] }).fatalIssues.some((issue) => issue.code === "recovery-collision"));
});

test("unexpected or materially changed unresolved source evidence is fatal", () => {
  const unexpected = plan({ sourceInvoiceArReferences: [
    { legacyRoNo: "2", legacyCustno: "ALIAS", total: "20" },
    { legacyRoNo: "3", legacyCustno: "RECOVERED", total: "30" },
    { legacyRoNo: "4", legacyCustno: "UNRESOLVED", total: "1" },
    { legacyRoNo: "5", legacyCustno: "NEW-UNKNOWN", total: "0" },
  ] });
  assert.ok(unexpected.fatalIssues.some((issue) => issue.code === "unexpected-unresolved"));
  assert.ok(unexpected.fatalIssues.some((issue) => issue.code === "stale-manifest-entry"));
});

test("known FINAL-to-AR differences resolve through authoritative AR without changing approved unresolved evidence", () => {
  const cases = [
    ["12659", "0", "87605505", "97.63"],
    ["16084", "87604050", "87603053", "50.00"],
    ["20534", "0", "87605900", "165.00"],
    ["20806", "0", "87605230", "106.31"],
    ["21246", "87611248", "87612026", "1204.79"],
  ];
  const extraCustomers = cases.map(([, , legacyCustno], index) => ({
    ...normalCustomer, id: `normal-${index}`, legacyCustno,
    displayName: `OTHER CUSTOMER ${index}`, addressLine1: `${index} OTHER ST`,
  }));
  const result = plan({
    stagedCustomers: [normalCustomer, ...extraCustomers],
    sourceInvoiceArReferences: [
      { legacyRoNo: "2", legacyCustno: "ALIAS", total: "20", sourceTable: "ar.DBF" },
      { legacyRoNo: "3", legacyCustno: "RECOVERED", total: "30", sourceTable: "ar.DBF" },
      { legacyRoNo: "4", legacyCustno: "UNRESOLVED", total: "0.00", sourceTable: "ar.DBF" },
      ...cases.flatMap(([legacyRoNo, finalCustomer, arCustomer, total]) => [
        { legacyRoNo, legacyCustno: finalCustomer, sourceTable: "FINAL.DBF" },
        { legacyRoNo, legacyCustno: arCustomer, total, sourceTable: "ar.DBF" },
      ]),
      { legacyRoNo: "21246", legacyCustno: "87612026", sourceTable: "FINAL.DBF" },
    ],
  });
  assert.deepEqual(result.fatalIssues, []);
  assert.equal(result.unexpectedUnresolved.length, 0);
  assert.deepEqual(result.unresolvedEntries.map((entry) => [entry.legacyRoNo, entry.legacyCustno, entry.total]), [["4", "UNRESOLVED", "0.00"]]);
  assert.equal(result.referenceDiagnostics.finalToArCustomerReferenceDifferences, 5);
  assert.equal(result.referenceDiagnostics.finalOnlyConflictingReferencesIgnored, 1);
  assert.equal(result.referenceDiagnostics.authoritativeArConflicts, 0);
});

test("authoritative AR conflicts are fatal during recovery planning", () => {
  const result = plan({ sourceInvoiceArReferences: [
    { legacyRoNo: "2", legacyCustno: "ALIAS", total: "20", sourceTable: "ar.DBF" },
    { legacyRoNo: "2", legacyCustno: "ALIAS", total: "21", sourceTable: "ar.DBF" },
    { legacyRoNo: "3", legacyCustno: "RECOVERED", total: "30", sourceTable: "ar.DBF" },
    { legacyRoNo: "4", legacyCustno: "UNRESOLVED", total: "0", sourceTable: "ar.DBF" },
  ] });
  assert.ok(result.fatalIssues.some((issue) => issue.code === "authoritative-ar-conflict"));
  assert.equal(result.referenceDiagnostics.authoritativeArConflicts, 1);
});

test("dry run performs no recovery writes and a transaction failure remains fatal", async () => {
  let transactions = 0;
  const recoveryPlan = plan();
  assert.deepEqual(await executeCutoverCustomerRecovery({ confirmedWrite: false, prisma: { $transaction: async () => { transactions += 1; } }, plan: recoveryPlan }), { executed: false, databaseWrites: 0 });
  assert.equal(transactions, 0);
  await assert.rejects(executeCutoverCustomerRecovery({
    confirmedWrite: true,
    prisma: { $transaction: async () => { transactions += 1; throw new Error("synthetic transaction failure"); } },
    plan: recoveryPlan,
  }), /synthetic transaction failure/);
  assert.equal(transactions, 1);
});

test("a confirmed recovery failure prevents every later Invoice stage", async () => {
  let laterStages = 0;
  await assert.rejects(runRecoveryBeforeLaterStages({
    runRecovery: async () => { throw new Error("recovery failed"); },
    runLaterStages: async () => { laterStages += 1; },
  }), /recovery failed/);
  assert.equal(laterStages, 0);
});

test("cutover wires recovery between Customer transformation and exact-run Invoice and Payment stages", async () => {
  const source = await readFile("scripts/legacy-cutover.mjs", "utf8");
  const customerTransform = source.indexOf('runScript("transform-customers-vehicles.mjs"');
  const recoveryWrite = source.indexOf("executeCutoverCustomerRecovery({ confirmedWrite: true");
  const vehicleRecoveryWrite = source.indexOf("executeCutoverVehicleRecovery({ confirmedWrite: true");
  const invoiceStage = source.indexOf('runScriptWithOutput("import-invoices.mjs"');
  const paymentStage = source.indexOf("loadLegacyPaymentStageProjection({ prisma, shopId, importRunId: invoiceImportRunId");
  const openOrderStage = source.indexOf('runScript("import-open-orders.mjs"');
  assert.ok(customerTransform > 0 && recoveryWrite > 0 && vehicleRecoveryWrite > recoveryWrite && invoiceStage > 0);
  assert.ok(paymentStage > 0 && openOrderStage > paymentStage);
  assert.match(source, /runRecoveryBeforeLaterStages\(\{[\s\S]*runRecovery:[\s\S]*runLaterStages/);
  assert.match(source, /runRecovery:[\s\S]*executeCutoverCustomerRecovery[\s\S]*planCutoverVehicleRecovery[\s\S]*executeCutoverVehicleRecovery/);
  assert.match(source, /sourceFingerprint:\s*sourceDirectory\.fingerprint/);
  assert.match(source, /importRunId,/);
  assert.match(source, /recoveryContext\.manifest/);
  assert.doesNotMatch(source, /runScript(?:WithOutput)?\("import-legacy-payments\.mjs"/);
  const approvalGate = source.indexOf("loadAndValidateRecoveryApprovalV4");
  const backupGate = source.indexOf("const backup = await createBackup");
  const resetGate = source.indexOf("await resetOperationalData");
  assert.ok(approvalGate > 0 && backupGate > approvalGate && resetGate > backupGate);
  assert.match(source, /requireFinalCutoverRecoveryApproval\(\{ finalCutover: snapshotBoundFinalMode, recoveryRequired: requiresRecovery/);
});

test("private approved aggregate contract is skipped without its reviewed manifest", { skip: !process.env.LEGACY_CUSTOMER_RECOVERY_APPROVED_MANIFEST }, () => {
  assert.ok(process.env.LEGACY_CUSTOMER_RECOVERY_APPROVED_MANIFEST);
});

test("approved seed integration contract contains only non-sensitive aggregate expectations", () => {
  assert.deepEqual(APPROVED_SEED_RECOVERY_AGGREGATE, {
    matchedInvoicesAfterRecovery: 11_665,
    unresolvedInvoiceSourceRows: 1,
    matchedCustomersForPaymentProjection: 11_665,
    unresolvedCustomersForPaymentProjection: 1,
  });
});
