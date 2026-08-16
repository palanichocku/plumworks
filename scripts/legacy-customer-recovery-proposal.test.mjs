import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ALIAS_DECISION,
  assembleRecoveryProposal,
  buildRecoveryApprovalV4,
  buildRecoveryApprovalV3,
  CREATE_DECISION,
  extractRecoveryCandidates,
  RECOVERY_APPROVAL_TYPE,
  requireFinalCutoverRecoveryApproval,
  UNRESOLVED_DECISION,
  UNKNOWN_DECISION,
  validateRecoveryApprovalV4,
  validateProposalStructure,
  validateRecoveryApprovalV3,
  VEHICLE_CREATE,
  VEHICLE_EVIDENCE_ONLY,
  VEHICLE_AMBIGUOUS,
  VEHICLE_EXACT_VIN,
  VEHICLE_SAFE_CREATE,
} from "./lib/legacy-customer-recovery-proposal.mjs";
import { atomicPrivateJsonWrite, evidenceHash, keyedEvidenceRows, sha256 } from "./lib/legacy-snapshot-evidence.mjs";

const shopId = "11111111-1111-4111-8111-111111111111";
const hash = (character) => character.repeat(64);
const binding = {
  shopId, snapshotDate: "2026-07-11", zipSha256: hash("a"), snapshotManifestSha256: hash("b"),
  combinedSourceFingerprint: hash("c"), applicationRoot: "Shopman32", dataDirectory: "Shopman32/data",
  sourceHashes: { "Cust.DBF": hash("d"), "vehicles.DBF": hash("e"), "FINAL.DBF": hash("f"), "laborfinal.DBF": hash("1"), "ar.DBF": hash("2") },
};

function keyed(rawRows, model) {
  return keyedEvidenceRows(rawRows.map((rawData, index) => ({ physicalRecordNumber: index + 1, deleted: false, rawData })), model);
}

function fixtureRows() {
  return {
    customers: keyed([{ CUSTNO: "NORMAL", CUSTOMER: "Example Customer", ADDRESS: "10 Main St", PHONE: "555-555-0100" }], "rawLegacyCustomer"),
    vehicles: keyed([
      { CUSTNO: "ALIAS", CARNO: "VA", YEAR: "2010" },
      { CUSTNO: "RECOVER", CARNO: "VR", YEAR: "2011" },
      { CUSTNO: "UNKNOWN", CARNO: "VU", YEAR: "2012" },
    ], "rawLegacyVehicle"),
    final: keyed([
      { RO_NO: "2", CUSTNO: "WRONG", CARNO: "VA" }, { RO_NO: "3", CUSTNO: "RECOVER", CARNO: "VR" },
      { RO_NO: "4", CUSTNO: "UNKNOWN", CARNO: "VU" }, { RO_NO: "5", CUSTNO: "UNRESOLVED" },
    ], "rawLegacyFinal"),
    laborFinal: keyed([{ RO_NO: "3", CUSTNO: "RECOVER" }], "rawLegacyLaborFinal"),
    ar: keyed([
      { RO_NO: "2", CUSTNO: "ALIAS", CUSTOMER: "Example Customer", ADDRESS: "10 Main St", TOTAL: "20.00" },
      { RO_NO: "3", CUSTNO: "RECOVER", CUSTOMER: "Historical Customer", ADDRESS: "20 Old St", TOTAL: "30.00" },
      { RO_NO: "4", CUSTNO: "UNKNOWN", CUSTOMER: null, ADDRESS: null, TOTAL: "10.00" },
      { RO_NO: "5", CUSTNO: "UNRESOLVED", CUSTOMER: null, ADDRESS: null, TOTAL: "0.00" },
    ], "rawLegacyAr"),
  };
}

function proposal(generatedAt = "2026-08-16T00:00:00.000Z", rows = fixtureRows()) {
  return assembleRecoveryProposal({ binding, extracted: extractRecoveryCandidates(rows), generatedAt });
}

function reviewedFor(value, proposalSha256 = hash("9")) {
  const decisions = [...value.candidates, ...value.unresolvedCandidates].map((candidate) => {
    const base = { candidateId: candidate.candidateId, decisionType: candidate.candidateType, reason: "Reviewed synthetic evidence." };
    if (candidate.candidateType === ALIAS_DECISION) return { ...base, existingCustomerLegacyId: "NORMAL", normalizedName: "EXAMPLE CUSTOMER", normalizedAddress: "10 MAIN ST" };
    if (candidate.candidateType === CREATE_DECISION) return { ...base, classification: "normal-historical", displayName: "Synthetic Historical Customer" };
    if (candidate.candidateType === UNKNOWN_DECISION) return { ...base, classification: "historical-unknown", displayName: "Historical Unknown Customer Synthetic" };
    return { ...base, disposition: "keep-skipped" };
  });
  const vehicleDecisions = value.vehicleCandidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    action: candidate.classification === "safe-create-candidate" ? VEHICLE_CREATE : VEHICLE_EVIDENCE_ONLY,
    operationalState: candidate.classification === "safe-create-candidate" ? "archived" : undefined,
    reason: "Reviewed synthetic Vehicle evidence.",
  }));
  return { formatVersion: 1, artifactType: "legacy-customer-recovery-reviewed-decisions", proposalSha256, candidateSetSha256: value.candidateSetSha256, decisions, vehicleCandidateSetSha256: value.vehicleCandidateSetSha256, vehicleDecisions };
}

test("candidate extraction deterministically finds every supported decision family and preserves AR authority", () => {
  const first = proposal();
  const second = proposal("2026-08-17T00:00:00.000Z");
  assert.equal(first.candidateSetSha256, second.candidateSetSha256);
  assert.equal(first.deterministicPayloadSha256, second.deterministicPayloadSha256);
  assert.notEqual(first.generatedAt, second.generatedAt);
  assert.deepEqual(first.candidates.map((candidate) => candidate.candidateType).sort(), [ALIAS_DECISION, CREATE_DECISION, UNKNOWN_DECISION].sort());
  assert.equal(first.unresolvedCandidates[0].candidateType, UNRESOLVED_DECISION);
  assert.equal(first.summary.affectedOrders, 4);
  assert.equal(validateProposalStructure(first).length, 0);
  const alias = first.candidates.find((candidate) => candidate.candidateType === ALIAS_DECISION);
  assert.equal(alias.sourceEvidence.arRows[0].legacyCustomerId, "ALIAS");
  assert.equal(alias.suggestedDecision.targetLegacyCustomerId, "NORMAL");
});

test("DBF traversal order and generation timestamp cannot change the candidate digest", () => {
  const rows = fixtureRows();
  const reordered = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, [...values].reverse()]));
  assert.equal(proposal("2026-08-16T00:00:00Z", rows).candidateSetSha256, proposal("2026-08-18T00:00:00Z", reordered).candidateSetSha256);
});

test("Vehicle candidate classification derives safe-create, exact-VIN, and ambiguous plate/YMM evidence", () => {
  const rows = {
    customers: keyed([{ CUSTNO: "NORMAL", CUSTOMER: "Normal Synthetic" }], "rawLegacyCustomer"),
    vehicles: keyed([
      { CUSTNO: "RECOVER", CARNO: "SAFE", YEAR: "2011", MAKE: "A", MODEL: "One" },
      { CUSTNO: "RECOVER", CARNO: "VIN", YEAR: "2012", MAKE: "B", MODEL: "Two", VIN: "1HGCM82633A004352" },
      { CUSTNO: "RECOVER", CARNO: "PLATE", YEAR: "2013", MAKE: "C", MODEL: "Three", LICENSE: "SYN123" },
      { CUSTNO: "NORMAL", CARNO: "CANON-VIN", YEAR: "2020", MAKE: "Different", MODEL: "Owner", VIN: "1HGCM82633A004352" },
      { CUSTNO: "NORMAL", CARNO: "CANON-PLATE", YEAR: "2013", MAKE: "C", MODEL: "Three", LICENSE: "SYN123" },
    ], "rawLegacyVehicle"),
    final: keyed([
      { RO_NO: "10", CUSTNO: "RECOVER", CARNO: "SAFE" },
      { RO_NO: "11", CUSTNO: "RECOVER", CARNO: "VIN" },
      { RO_NO: "12", CUSTNO: "RECOVER", CARNO: "PLATE" },
    ], "rawLegacyFinal"),
    laborFinal: [],
    ar: keyed([
      { RO_NO: "10", CUSTNO: "RECOVER", CARNO: "SAFE", CUSTOMER: "Historical", TOTAL: "1.00" },
      { RO_NO: "11", CUSTNO: "RECOVER", CARNO: "VIN", CUSTOMER: "Historical", TOTAL: "1.00" },
      { RO_NO: "12", CUSTNO: "RECOVER", CARNO: "PLATE", CUSTOMER: "Historical", TOTAL: "1.00" },
    ], "rawLegacyAr"),
  };
  const extracted = extractRecoveryCandidates(rows);
  assert.deepEqual(extracted.vehicleCandidates.map((candidate) => candidate.classification).sort(), [VEHICLE_AMBIGUOUS, VEHICLE_EXACT_VIN, VEHICLE_SAFE_CREATE].sort());
  assert.equal(extracted.vehicleCandidates.find((candidate) => candidate.classification === VEHICLE_EXACT_VIN).collisionEvidence.targets[0].matchBasis, "exact-valid-vin");
  assert.equal(extracted.vehicleCandidates.find((candidate) => candidate.classification === VEHICLE_AMBIGUOUS).collisionEvidence.targets[0].matchBasis, "exact-plate-and-ymm");
});

test("source row, deleted state, Vehicle evidence, candidate membership, and RO-set changes invalidate the candidate set", () => {
  const baseline = proposal();
  const variants = [];
  const changed = fixtureRows(); changed.ar[0].rawData.TOTAL = "21.00"; changed.ar[0].evidenceSha256 = evidenceHash({ deleted: false, rawData: changed.ar[0].rawData }); variants.push(["changed row", changed]);
  const deleted = fixtureRows(); deleted.ar[0].deleted = true; deleted.ar[0].evidenceSha256 = evidenceHash({ deleted: true, rawData: deleted.ar[0].rawData }); variants.push(["deleted state", deleted]);
  const vehicle = fixtureRows(); vehicle.vehicles[0].rawData.YEAR = "2015"; vehicle.vehicles[0].evidenceSha256 = evidenceHash({ deleted: false, rawData: vehicle.vehicles[0].rawData }); variants.push(["Vehicle evidence", vehicle]);
  const added = fixtureRows(); added.ar.push(...keyed([{ RO_NO: "6", CUSTNO: "NEW", CUSTOMER: "New", ADDRESS: "30 Old", TOTAL: "1.00" }], "rawLegacyAr")); variants.push(["candidate membership", added]);
  const order = fixtureRows(); order.ar[1].rawData.RO_NO = "33"; order.ar[1].evidenceSha256 = evidenceHash({ deleted: false, rawData: order.ar[1].rawData }); variants.push(["RO set", order]);
  for (const [label, rows] of variants) assert.notEqual(proposal(undefined, rows).candidateSetSha256, baseline.candidateSetSha256, label);
});

test("approval requires explicit complete review and produces v3 without inferring proposal suggestions", () => {
  const value = proposal();
  const proposalSha256 = hash("9");
  const reviewed = reviewedFor(value, proposalSha256);
  const approval = buildRecoveryApprovalV3({ proposal: value, proposalSha256, reviewed, reviewedBy: "Synthetic Reviewer", reviewedAt: "2026-08-16T12:00:00Z", reason: "Synthetic fixture approval." });
  assert.equal(approval.formatVersion, 3);
  assert.equal(approval.artifactType, RECOVERY_APPROVAL_TYPE);
  assert.equal(approval.approval.approved, true);
  assert.equal(approval.decisions.length, 4);
  assert.equal(validateRecoveryApprovalV3({ approval, proposal: value, proposalSha256, shopId }).length, 0);
  assert.throws(() => buildRecoveryApprovalV3({ proposal: value, proposalSha256, reviewed: { ...reviewed, decisions: reviewed.decisions.slice(1) }, reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" }), /Every recovery candidate/);
  assert.throws(() => buildRecoveryApprovalV3({ proposal: value, proposalSha256, reviewed, reviewedBy: "", reviewedAt: "bad", reason: "" }), /metadata/);
});

test("Approval v4 requires explicit complete Customer and Vehicle review", () => {
  const value = proposal();
  const proposalSha256 = hash("9");
  const reviewed = reviewedFor(value, proposalSha256);
  const approval = buildRecoveryApprovalV4({ proposal: value, proposalSha256, reviewed, reviewedBy: "Synthetic Reviewer", reviewedAt: "2026-08-16T12:00:00Z", reason: "Synthetic fixture approval." });
  assert.equal(approval.formatVersion, 4);
  assert.equal(approval.vehicleDecisions.length, value.vehicleCandidates.length);
  assert.equal(validateRecoveryApprovalV4({ approval, proposal: value, proposalSha256, shopId }).length, 0);
  assert.throws(() => buildRecoveryApprovalV4({ proposal: value, proposalSha256, reviewed: { ...reviewed, vehicleDecisions: reviewed.vehicleDecisions.slice(1) }, reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" }), /Every Vehicle recovery candidate/);
  assert.throws(() => buildRecoveryApprovalV4({ proposal: value, proposalSha256, reviewed: { ...reviewed, vehicleDecisions: reviewed.vehicleDecisions.map((decision, index) => index ? decision : { ...decision, action: undefined }) }, reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" }), /Unknown Vehicle recovery decision/);
});

test("Vehicle evidence mutations invalidate v4 approval", () => {
  const value = proposal(); const proposalSha256 = hash("9");
  const approval = buildRecoveryApprovalV4({ proposal: value, proposalSha256, reviewed: reviewedFor(value, proposalSha256), reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" });
  for (const mutate of [
    (item) => { item.vehicleCandidateSetSha256 = hash("0"); },
    (item) => { item.vehicleDecisions[0].sourceVehicle.evidenceSha256 = hash("1"); },
    (item) => { item.vehicleDecisions[0].sourceVehicle.deleted = !item.vehicleDecisions[0].sourceVehicle.deleted; },
    (item) => { item.vehicleDecisions[0].affectedOrderNumbers.push("999"); },
    (item) => { item.vehicleDecisions[0].recoveredCustomerLegacyId = "OTHER"; },
    (item) => { item.vehicleDecisions[0].vehicleEvidenceSha256 = hash("2"); },
    (item) => { item.vehicleDecisions[0].collisionEvidenceSha256 = hash("3"); },
  ]) {
    const changed = structuredClone(approval); mutate(changed);
    assert.ok(validateRecoveryApprovalV4({ approval: changed, proposal: value, proposalSha256, shopId }).length > 0);
  }
});

test("approval validation fails closed for every snapshot binding and reviewed-evidence mutation", () => {
  const value = proposal(); const proposalSha256 = hash("9");
  const approval = buildRecoveryApprovalV3({ proposal: value, proposalSha256, reviewed: reviewedFor(value, proposalSha256), reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" });
  const mutations = [
    (item) => { item.snapshot.shopId = "22222222-2222-4222-8222-222222222222"; },
    (item) => { item.snapshot.zipSha256 = hash("3"); },
    (item) => { item.snapshot.snapshotManifestSha256 = hash("4"); },
    (item) => { item.snapshot.combinedSourceFingerprint = hash("5"); },
    (item) => { item.snapshot.sourceHashes["ar.DBF"] = hash("6"); },
    (item) => { item.proposalSha256 = hash("7"); },
    (item) => { item.candidateSetSha256 = hash("8"); },
    (item) => { item.decisions[0].candidateEvidenceSha256 = hash("0"); },
    (item) => { item.decisions[0].referencedOrderNumbers.push("999"); },
    (item) => { item.decisions[0].decisionType = "unknown"; },
    (item) => { item.approval.approved = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(approval); mutate(changed);
    assert.ok(validateRecoveryApprovalV3({ approval: changed, proposal: value, proposalSha256, shopId }).length > 0);
  }
});

test("proposal-only and v1/v2/v3 formats cannot authorize strengthened final cutover", () => {
  const value = proposal();
  assert.notEqual(value.artifactType, RECOVERY_APPROVAL_TYPE);
  for (const historical of [{ manifestVersion: "1.0.0" }, { manifestVersion: "2.0.0" }]) {
    assert.ok(validateRecoveryApprovalV3({ approval: historical, proposal: value, proposalSha256: sha256("proposal"), shopId }).some((issue) => issue.code === "invalid-recovery-approval-format"));
    assert.throws(() => requireFinalCutoverRecoveryApproval({ finalCutover: true, recoveryRequired: true, artifact: historical }), /cannot authorize backup or reset/);
  }
  const v3 = buildRecoveryApprovalV3({ proposal: value, proposalSha256: hash("9"), reviewed: reviewedFor(value, hash("9")), reviewedBy: "R", reviewedAt: "2026-08-16", reason: "R" });
  assert.throws(() => requireFinalCutoverRecoveryApproval({ finalCutover: true, recoveryRequired: true, artifact: value }), /Recovery Approval v4/);
  assert.throws(() => requireFinalCutoverRecoveryApproval({ finalCutover: true, recoveryRequired: true, artifact: v3 }), /v1\/v2\/v3/);
  assert.doesNotThrow(() => requireFinalCutoverRecoveryApproval({ finalCutover: false, recoveryRequired: true, artifact: { manifestVersion: "2.0.0" } }));
});

test("private artifacts are atomic, non-overwriting, mode 0600, and proposal code has no database client", async () => {
  const root = await mkdtemp(join(tmpdir(), "customer-recovery-private-"));
  const output = join(root, "proposal.json");
  try {
    await atomicPrivateJsonWrite(output, { status: "proposed" });
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { status: "proposed" });
    await assert.rejects(atomicPrivateJsonWrite(output, { status: "changed" }), /already exists/);
    const source = await readFile("scripts/lib/legacy-customer-recovery-proposal.mjs", "utf8");
    assert.doesNotMatch(source, /PrismaClient|DATABASE_URL|\$transaction|\.create\(|\.update\(|\.delete\(/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
