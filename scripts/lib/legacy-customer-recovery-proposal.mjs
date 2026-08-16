import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { normalizedFullPhone, normalizedWords } from "./legacy-customer-recovery.mjs";
import { parseLegacyMoneyCents } from "./legacy-invoice-financials.mjs";
import { validateSnapshotManifestForRecovery } from "./legacy-recovery-upgrade.mjs";
import {
  atomicPrivateJsonWrite,
  canonicalJson,
  evidenceHash,
  keyedEvidenceRows,
  readablePrivateJson,
  sha256,
} from "./legacy-snapshot-evidence.mjs";

export const RECOVERY_PROPOSAL_VERSION = 1;
export const RECOVERY_PROPOSAL_TYPE = "legacy-customer-recovery-proposal";
export const RECOVERY_APPROVAL_VERSION = 3;
export const RECOVERY_APPROVAL_TYPE = "legacy-customer-recovery-approval";
export const REVIEW_DECISIONS_VERSION = 1;
export const REVIEW_DECISIONS_TYPE = "legacy-customer-recovery-reviewed-decisions";
export const RECOVERY_APPROVAL_CONFIRMATION = "APPROVE_CUSTOMER_RECOVERY_V3";
export const RECOVERY_RELEVANT_FILES = Object.freeze([
  "Cust.DBF", "vehicles.DBF", "FINAL.DBF", "laborfinal.DBF", "ar.DBF",
]);
export const ALIAS_DECISION = "alias-existing-customer";
export const CREATE_DECISION = "create-recovered-historical-customer";
export const UNKNOWN_DECISION = "create-historical-unknown-customer";
export const UNRESOLVED_DECISION = "keep-exact-zero-dollar-reference-unresolved";

export function isRecoveryApprovalV3(value) {
  return value?.formatVersion === RECOVERY_APPROVAL_VERSION && value?.artifactType === RECOVERY_APPROVAL_TYPE;
}

export function requireFinalCutoverRecoveryApproval({ finalCutover, recoveryRequired, artifact }) {
  if (finalCutover && recoveryRequired && !isRecoveryApprovalV3(artifact)) {
    throw new Error("Final-cutover Customer recovery requires an approved snapshot-bound Recovery Approval v3; v1/v2 compatibility manifests cannot authorize backup or reset.");
  }
}

const decoder = new TextDecoder("windows-1252");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

function text(value) { return value == null ? "" : String(value).trim(); }
function normalizedId(value) { return text(value).toUpperCase(); }
function fieldName(value) { return value.toUpperCase().replaceAll("_", ""); }
function field(rawData, candidates) {
  const match = Object.entries(rawData ?? {}).find(([key]) => candidates.includes(fieldName(key)));
  return match ? text(match[1]) : "";
}
function identifier(row, candidates) { return field(row.rawData, candidates); }
function sortText(values) { return [...values].sort((left, right) => left.localeCompare(right, "en-US")); }
function unique(values) { return sortText(new Set(values)); }
function nonblank(value) { return typeof value === "string" && value.trim().length > 0; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }

function decode(value, type) {
  if (type === "0") return undefined;
  if (["C", "N", "F", "D"].includes(type)) return decoder.decode(value).trim() || null;
  if (type === "L") {
    const logical = decoder.decode(value).trim().toUpperCase();
    if (["T", "Y"].includes(logical)) return true;
    if (["F", "N"].includes(logical)) return false;
    return null;
  }
  if (type === "I" && value.length === 4) return value.readInt32LE();
  if (type === "B" && value.length === 8) {
    const number = value.readDoubleLE();
    return Number.isFinite(number) ? number : null;
  }
  if (["M", "G", "P"].includes(type)) {
    const pointer = value.length >= 4 ? value.readUInt32LE() : 0;
    return pointer ? { memoPointer: String(pointer) } : null;
  }
  return { hex: value.toString("hex") };
}

export function readRecoveryEvidenceDbf(file, sourceModel) {
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const descriptors = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const end = descriptor.indexOf(0);
    const length = descriptor[16];
    descriptors.push({ name: decoder.decode(descriptor.subarray(0, end === -1 ? 11 : end)).trim(), type: String.fromCharCode(descriptor[11]), length, recordOffset });
    recordOffset += length;
  }
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    const record = file.subarray(headerLength + index * recordLength, headerLength + (index + 1) * recordLength);
    if (record.length !== recordLength) throw new Error(`DBF row ${index + 1} is truncated.`);
    const rawData = {};
    for (const descriptor of descriptors) {
      const value = decode(record.subarray(descriptor.recordOffset, descriptor.recordOffset + descriptor.length), descriptor.type);
      if (value !== undefined) rawData[descriptor.name] = value;
    }
    rows.push({ physicalRecordNumber: index + 1, deleted: record[0] === 0x2a, rawData });
  }
  return keyedEvidenceRows(rows, sourceModel);
}

function rowReference(row, table) {
  return {
    table,
    stableRowKey: row.stableRowKey,
    deleted: row.deleted,
    evidenceSha256: row.evidenceSha256,
  };
}

function customerProjection(row) {
  const legacyCustomerId = normalizedId(identifier(row, ["CUSTNO", "CUSTOMERNO"]));
  const displayName = normalizedWords(field(row.rawData, ["CUSTOMER"]));
  if (row.deleted || !legacyCustomerId || !displayName) return null;
  return {
    legacyCustomerId,
    normalizedName: displayName,
    normalizedAddress: normalizedWords(field(row.rawData, ["ADDRESS"])),
    phoneHashes: unique([field(row.rawData, ["PHONE"]), field(row.rawData, ["PHONE2"])]
      .map(normalizedFullPhone).filter(Boolean).map((phone) => sha256(phone))),
    row,
  };
}

function candidateEvidenceHash(candidate) {
  const payload = { ...candidate };
  delete payload.candidateId;
  delete payload.evidenceSha256;
  return evidenceHash(payload);
}

function candidateId(candidate) {
  return `${candidate.candidateType}:${candidate.legacyCustomerId}:${candidateEvidenceHash(candidate).slice(0, 24)}`;
}

function normalizedTotal(value) {
  const cents = parseLegacyMoneyCents(value);
  return cents == null ? null : `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

function sourceRowsForCandidate({ customerId, orders, rows }) {
  const orderSet = new Set(orders);
  const customerRows = rows.customers.filter((row) => normalizedId(identifier(row, ["CUSTNO", "CUSTOMERNO"])) === customerId);
  const finalRows = rows.final.filter((row) => orderSet.has(normalizedId(identifier(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]))));
  const laborRows = rows.laborFinal.filter((row) => orderSet.has(normalizedId(identifier(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]))));
  const arRows = rows.ar.filter((row) => orderSet.has(normalizedId(identifier(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]))));
  const referencedVehicleIds = new Set([...finalRows, ...laborRows].map((row) => normalizedId(identifier(row, ["CARNO", "VEHICLENO"]))).filter(Boolean));
  const vehicleRows = rows.vehicles.filter((row) =>
    normalizedId(identifier(row, ["CUSTNO", "CUSTOMERNO"])) === customerId &&
    referencedVehicleIds.has(normalizedId(identifier(row, ["CARNO", "VEHICLENO"])))
  );
  return {
    customerRows: customerRows.map((row) => rowReference(row, "Cust.DBF")),
    vehicleRows: vehicleRows.map((row) => ({
      ...rowReference(row, "vehicles.DBF"),
      legacyVehicleId: normalizedId(identifier(row, ["CARNO", "VEHICLENO"])),
    })),
    finalRows: finalRows.map((row) => rowReference(row, "FINAL.DBF")),
    laborFinalRows: laborRows.map((row) => rowReference(row, "laborfinal.DBF")),
    arRows: arRows.map((row) => ({
      ...rowReference(row, "ar.DBF"),
      legacyOrderNumber: normalizedId(identifier(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"])),
      legacyCustomerId: normalizedId(identifier(row, ["CUSTNO", "CUSTOMERNO"])),
      total: normalizedTotal(field(row.rawData, ["TOTAL"])),
    })),
  };
}

function candidateSort(left, right) {
  return [left.candidateType, left.legacyCustomerId, left.referencedOrderNumbers[0] ?? "", left.candidateId]
    .join("\0").localeCompare([right.candidateType, right.legacyCustomerId, right.referencedOrderNumbers[0] ?? "", right.candidateId].join("\0"), "en-US");
}

export function extractRecoveryCandidates(rows) {
  const normalCustomers = rows.customers.map(customerProjection).filter(Boolean);
  const normalByLegacy = new Map(normalCustomers.map((customer) => [customer.legacyCustomerId, customer]));
  const normalByIdentity = new Map();
  for (const customer of normalCustomers) {
    const key = customer.normalizedName && customer.normalizedAddress ? `${customer.normalizedName}\0${customer.normalizedAddress}` : "";
    if (!key) continue;
    const values = normalByIdentity.get(key) ?? [];
    values.push(customer);
    normalByIdentity.set(key, values);
  }
  const arGroups = new Map();
  for (const row of rows.ar.filter((item) => !item.deleted)) {
    const legacyCustomerId = normalizedId(identifier(row, ["CUSTNO", "CUSTOMERNO"]));
    if (!legacyCustomerId || normalByLegacy.has(legacyCustomerId)) continue;
    const group = arGroups.get(legacyCustomerId) ?? [];
    group.push(row);
    arGroups.set(legacyCustomerId, group);
  }
  const candidates = [];
  const unresolvedCandidates = [];
  for (const [legacyCustomerId, arRows] of arGroups) {
    const orders = unique(arRows.map((row) => normalizedId(identifier(row, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]))).filter(Boolean));
    const identities = unique(arRows.map((row) => `${normalizedWords(field(row.rawData, ["CUSTOMER"]))}\0${normalizedWords(field(row.rawData, ["ADDRESS"]))}`));
    const identityMatchPairs = identities.flatMap((identity) => {
      const [name, address] = identity.split("\0");
      return name && address ? (normalByIdentity.get(identity) ?? []).map((target) => ({ identity, name, address, target })) : [];
    });
    const identityTargetIds = unique(identityMatchPairs.map((match) => match.target.legacyCustomerId));
    if (identityTargetIds.length > 1) throw new Error(`Customer recovery candidate ${legacyCustomerId} has multiple exact normal Customer targets.`);
    const selectedIdentity = identityTargetIds.length === 1
      ? identityMatchPairs.find((match) => match.target.legacyCustomerId === identityTargetIds[0])
      : identities.map((identity) => identity.split("\0")).map(([name, address]) => ({ name, address })).find((identity) => identity.name) ?? { name: "", address: "" };
    const normalizedName = selectedIdentity.name;
    const normalizedAddress = selectedIdentity.address;
    const totals = unique(arRows.map((row) => normalizedTotal(field(row.rawData, ["TOTAL"])) ?? "invalid"));
    if (totals.includes("invalid")) throw new Error(`Customer recovery candidate ${legacyCustomerId} has an invalid authoritative AR total.`);
    const evidence = sourceRowsForCandidate({ customerId: legacyCustomerId, orders, rows });
    const phoneHashes = unique(arRows.flatMap((row) => [field(row.rawData, ["PHONE"]), field(row.rawData, ["PHONE2"])]).map(normalizedFullPhone).filter(Boolean).map((phone) => sha256(phone)));
    let candidateType;
    let suggestedDecision;
    if (identityTargetIds.length === 1) {
      candidateType = ALIAS_DECISION;
      const target = selectedIdentity.target;
      suggestedDecision = {
        decisionType: ALIAS_DECISION,
        targetLegacyCustomerId: target.legacyCustomerId,
        targetSourceRow: rowReference(target.row, "Cust.DBF"),
        identityEvidenceSha256: evidenceHash({ normalizedName, normalizedAddress }),
      };
    } else if (normalizedName) {
      candidateType = CREATE_DECISION;
      suggestedDecision = { decisionType: CREATE_DECISION, classification: "normal-historical" };
    } else if (totals.every((total) => total === "0.00")) {
      candidateType = UNRESOLVED_DECISION;
      suggestedDecision = { decisionType: UNRESOLVED_DECISION, disposition: "keep-skipped" };
    } else {
      candidateType = UNKNOWN_DECISION;
      suggestedDecision = { decisionType: UNKNOWN_DECISION, classification: "historical-unknown" };
    }
    const candidate = {
      candidateType,
      legacyCustomerId,
      referencedOrderNumbers: orders,
      authoritativeTotals: totals,
      identityEvidence: {
        normalizedNameSha256: normalizedName ? sha256(normalizedName) : null,
        normalizedAddressSha256: normalizedAddress ? sha256(normalizedAddress) : null,
        observedIdentitySha256: identities.map((identity) => sha256(identity)).sort(),
        phoneSha256: phoneHashes,
        hasUsableName: Boolean(normalizedName),
        hasUsableAddress: Boolean(normalizedAddress),
      },
      vehicleEvidence: {
        classification: evidence.vehicleRows.length ? "historical-supporting-identity-not-recovered" : "none",
        rowCount: evidence.vehicleRows.length,
        sourceRows: evidence.vehicleRows.sort((a, b) => a.stableRowKey.localeCompare(b.stableRowKey, "en-US")),
      },
      sourceEvidence: {
        customerRows: evidence.customerRows,
        arRows: evidence.arRows.sort((a, b) => a.stableRowKey.localeCompare(b.stableRowKey, "en-US")),
        finalRows: evidence.finalRows.sort((a, b) => a.stableRowKey.localeCompare(b.stableRowKey, "en-US")),
        laborFinalRows: evidence.laborFinalRows.sort((a, b) => a.stableRowKey.localeCompare(b.stableRowKey, "en-US")),
      },
      suggestedDecision,
    };
    candidate.candidateId = candidateId(candidate);
    candidate.evidenceSha256 = candidateEvidenceHash(candidate);
    if (candidateType === UNRESOLVED_DECISION) unresolvedCandidates.push(candidate);
    else candidates.push(candidate);
  }
  candidates.sort(candidateSort);
  unresolvedCandidates.sort(candidateSort);
  return { normalCustomers, candidates, unresolvedCandidates };
}

async function loadRows(source) {
  const definitions = [
    ["customers", "Cust.DBF", "rawLegacyCustomer"],
    ["vehicles", "vehicles.DBF", "rawLegacyVehicle"],
    ["final", "FINAL.DBF", "rawLegacyFinal"],
    ["laborFinal", "laborfinal.DBF", "rawLegacyLaborFinal"],
    ["ar", "ar.DBF", "rawLegacyAr"],
  ];
  return Object.fromEntries(await Promise.all(definitions.map(async ([name, file, model]) => [name, readRecoveryEvidenceDbf(await readFile(source.files[file]), model)])));
}

export async function loadRecoverySnapshotContext({ snapshotManifestPath, shopId, repositoryRoot = process.cwd() }) {
  if (!UUID.test(shopId)) throw new Error("Shop identity must be a valid UUID.");
  const snapshot = await validateSnapshotManifestForRecovery({ manifestPath: snapshotManifestPath, repositoryRoot });
  const snapshotBytes = await readFile(snapshotManifestPath);
  return {
    ...snapshot,
    manifestFingerprint: sha256(snapshotBytes),
    shopId,
    binding: {
      shopId,
      snapshotDate: snapshot.manifest.snapshotDate,
      zipSha256: snapshot.manifest.zipSha256,
      snapshotManifestSha256: sha256(snapshotBytes),
      combinedSourceFingerprint: snapshot.sourceFingerprint,
      applicationRoot: snapshot.manifest.detectedApplicationRoot,
      dataDirectory: snapshot.manifest.detectedDataDirectory,
      sourceHashes: Object.fromEntries(RECOVERY_RELEVANT_FILES.map((file) => [file, snapshot.source.fingerprints[file]])),
    },
  };
}

export async function buildRecoveryProposal({ snapshotManifestPath, shopId, generatedAt = new Date().toISOString(), repositoryRoot = process.cwd() }) {
  const snapshot = await loadRecoverySnapshotContext({ snapshotManifestPath, shopId, repositoryRoot });
  const rows = await loadRows(snapshot.source);
  const extracted = extractRecoveryCandidates(rows);
  return assembleRecoveryProposal({ binding: snapshot.binding, extracted, generatedAt });
}

export function assembleRecoveryProposal({ binding, extracted, generatedAt = new Date().toISOString() }) {
  const deterministicPayload = {
    snapshot: binding,
    candidates: extracted.candidates,
    unresolvedCandidates: extracted.unresolvedCandidates,
  };
  const candidateSetSha256 = evidenceHash({ candidates: extracted.candidates, unresolvedCandidates: extracted.unresolvedCandidates });
  const recoveredCandidates = extracted.candidates.filter((candidate) => [CREATE_DECISION, UNKNOWN_DECISION].includes(candidate.candidateType));
  return {
    formatVersion: RECOVERY_PROPOSAL_VERSION,
    artifactType: RECOVERY_PROPOSAL_TYPE,
    generatedAt,
    snapshot: binding,
    deterministicPayloadSha256: evidenceHash(deterministicPayload),
    candidateSetSha256,
    candidates: extracted.candidates,
    unresolvedCandidates: extracted.unresolvedCandidates,
    summary: {
      normalCustomers: extracted.normalCustomers.length,
      aliasCandidates: extracted.candidates.filter((candidate) => candidate.candidateType === ALIAS_DECISION).length,
      recoveredCustomerCandidates: recoveredCandidates.length,
      historicalUnknownCandidates: extracted.candidates.filter((candidate) => candidate.candidateType === UNKNOWN_DECISION).length,
      unresolvedCandidates: extracted.unresolvedCandidates.length,
      affectedOrders: unique([...extracted.candidates, ...extracted.unresolvedCandidates].flatMap((candidate) => candidate.referencedOrderNumbers)).length,
      vehicleEvidenceRows: [...extracted.candidates, ...extracted.unresolvedCandidates].reduce((sum, candidate) => sum + candidate.vehicleEvidence.rowCount, 0),
      recoveredCustomerVehicleIdentifiers: unique(recoveredCandidates.flatMap((candidate) => candidate.vehicleEvidence.sourceRows.map((row) => row.legacyVehicleId).filter(Boolean))).length,
    },
    approval: { status: "proposed" },
  };
}

export async function writeRecoveryProposal(options) {
  const proposal = await buildRecoveryProposal(options);
  const output = await atomicPrivateJsonWrite(options.output, proposal, options.repositoryRoot);
  return { proposal, output };
}

function exact(left, right) { return canonicalJson(left) === canonicalJson(right); }

export function validateProposalStructure(proposal) {
  const issues = [];
  if (!object(proposal) || proposal.formatVersion !== RECOVERY_PROPOSAL_VERSION || proposal.artifactType !== RECOVERY_PROPOSAL_TYPE) issues.push({ code: "invalid-recovery-proposal-format" });
  if (proposal?.approval?.status !== "proposed") issues.push({ code: "proposal-must-remain-unapproved" });
  if (!Array.isArray(proposal?.candidates) || !Array.isArray(proposal?.unresolvedCandidates)) issues.push({ code: "missing-recovery-candidates" });
  const all = [...(proposal?.candidates ?? []), ...(proposal?.unresolvedCandidates ?? [])];
  if (new Set(all.map((candidate) => candidate.candidateId)).size !== all.length) issues.push({ code: "duplicate-recovery-candidate" });
  const expectedCandidateHash = evidenceHash({ candidates: proposal?.candidates ?? [], unresolvedCandidates: proposal?.unresolvedCandidates ?? [] });
  if (proposal?.candidateSetSha256 !== expectedCandidateHash) issues.push({ code: "proposal-candidate-hash-mismatch" });
  const expectedPayloadHash = evidenceHash({ snapshot: proposal?.snapshot, candidates: proposal?.candidates ?? [], unresolvedCandidates: proposal?.unresolvedCandidates ?? [] });
  if (proposal?.deterministicPayloadSha256 !== expectedPayloadHash) issues.push({ code: "proposal-payload-hash-mismatch" });
  for (const candidate of all) {
    if (!nonblank(candidate?.candidateId) || !nonblank(candidate?.legacyCustomerId) || !SHA.test(candidate?.evidenceSha256 ?? "") || !Array.isArray(candidate?.referencedOrderNumbers)) issues.push({ code: "malformed-recovery-candidate" });
    else if (candidate.evidenceSha256 !== candidateEvidenceHash(candidate) || candidate.candidateId !== candidateId(candidate)) issues.push({ code: "recovery-candidate-evidence-mismatch" });
  }
  return issues;
}

function reviewedDecisionMap(reviewed) {
  if (!object(reviewed) || reviewed.formatVersion !== REVIEW_DECISIONS_VERSION || reviewed.artifactType !== REVIEW_DECISIONS_TYPE || !Array.isArray(reviewed.decisions)) throw new Error("Reviewed decision input has an invalid format.");
  const map = new Map();
  for (const decision of reviewed.decisions) {
    if (!nonblank(decision?.candidateId) || map.has(decision.candidateId)) throw new Error("Reviewed decisions contain a missing or duplicate candidate ID.");
    map.set(decision.candidateId, decision);
  }
  return map;
}

function approvedDecision(candidate, reviewed) {
  if (reviewed.decisionType !== candidate.candidateType) throw new Error(`Reviewed decision type does not match candidate ${candidate.candidateId}.`);
  const common = {
    candidateId: candidate.candidateId,
    candidateEvidenceSha256: candidate.evidenceSha256,
    decisionType: reviewed.decisionType,
    legacyCustomerId: candidate.legacyCustomerId,
    referencedOrderNumbers: candidate.referencedOrderNumbers,
    vehicleEvidenceSha256: evidenceHash(candidate.vehicleEvidence),
    reason: nonblank(reviewed.reason) ? reviewed.reason.trim() : null,
  };
  if (!common.reason) throw new Error(`Reviewed decision ${candidate.candidateId} requires a reason.`);
  if (reviewed.decisionType === ALIAS_DECISION) {
    if (reviewed.existingCustomerLegacyId !== candidate.suggestedDecision.targetLegacyCustomerId || !nonblank(reviewed.normalizedName) || !nonblank(reviewed.normalizedAddress)) throw new Error(`Alias decision ${candidate.candidateId} does not match its exact target evidence.`);
    if (evidenceHash({ normalizedName: reviewed.normalizedName, normalizedAddress: reviewed.normalizedAddress }) !== candidate.suggestedDecision.identityEvidenceSha256) throw new Error(`Alias decision ${candidate.candidateId} identity evidence changed.`);
    return { ...common, existingCustomerLegacyId: reviewed.existingCustomerLegacyId, normalizedName: reviewed.normalizedName, normalizedAddress: reviewed.normalizedAddress, matchingMethod: "exact-normalized-name-address", confidence: "human-reviewed-deterministic" };
  }
  if ([CREATE_DECISION, UNKNOWN_DECISION].includes(reviewed.decisionType)) {
    const expectedClassification = reviewed.decisionType === UNKNOWN_DECISION ? "historical-unknown" : "normal-historical";
    if (reviewed.classification !== expectedClassification || !nonblank(reviewed.displayName)) throw new Error(`Recovered Customer decision ${candidate.candidateId} is incomplete.`);
    return {
      ...common,
      classification: reviewed.classification,
      displayName: reviewed.displayName.trim(),
      phone: reviewed.phone ?? null,
      alternatePhone: reviewed.alternatePhone ?? null,
      address: reviewed.address ?? null,
      city: reviewed.city ?? null,
      state: reviewed.state ?? null,
      postalCode: reviewed.postalCode ?? null,
      associatedLegacyVehicleIds: candidate.vehicleEvidence.sourceRows.map((row) => row.legacyVehicleId).filter(Boolean).sort(),
      sourceEvidence: { candidateId: candidate.candidateId, evidenceSha256: candidate.evidenceSha256 },
    };
  }
  if (reviewed.decisionType === UNRESOLVED_DECISION) {
    if (reviewed.disposition !== "keep-skipped" || candidate.authoritativeTotals.length !== 1 || candidate.authoritativeTotals[0] !== "0.00" || candidate.referencedOrderNumbers.length !== 1) throw new Error(`Unresolved decision ${candidate.candidateId} is outside the exact zero-dollar policy.`);
    return { ...common, legacyOrderNumber: candidate.referencedOrderNumbers[0], total: "0.00", disposition: "keep-skipped" };
  }
  throw new Error(`Unknown Customer recovery decision type: ${reviewed.decisionType}.`);
}

export function buildRecoveryApprovalV3({ proposal, proposalSha256, reviewed, reviewedBy, reviewedAt, reason }) {
  const proposalIssues = validateProposalStructure(proposal);
  if (proposalIssues.length) throw new Error(`Recovery proposal validation failed: ${proposalIssues[0].code}.`);
  if (!SHA.test(proposalSha256) || !nonblank(reviewedBy) || !nonblank(reason) || !nonblank(reviewedAt) || Number.isNaN(Date.parse(reviewedAt))) throw new Error("Approval metadata is incomplete or invalid.");
  if (reviewed.proposalSha256 !== proposalSha256 || reviewed.candidateSetSha256 !== proposal.candidateSetSha256) throw new Error("Reviewed decisions do not bind to the exact proposal.");
  const map = reviewedDecisionMap(reviewed);
  const candidates = [...proposal.candidates, ...proposal.unresolvedCandidates];
  if (map.size !== candidates.length || candidates.some((candidate) => !map.has(candidate.candidateId))) throw new Error("Every recovery candidate must have exactly one explicit reviewed decision.");
  const decisions = candidates.map((candidate) => approvedDecision(candidate, map.get(candidate.candidateId))).sort((left, right) => left.candidateId.localeCompare(right.candidateId, "en-US"));
  const expectedCounts = {
    aliases: decisions.filter((decision) => decision.decisionType === ALIAS_DECISION).length,
    recoveredCustomers: decisions.filter((decision) => [CREATE_DECISION, UNKNOWN_DECISION].includes(decision.decisionType)).length,
    historicalUnknown: decisions.filter((decision) => decision.decisionType === UNKNOWN_DECISION).length,
    unresolved: decisions.filter((decision) => decision.decisionType === UNRESOLVED_DECISION).length,
    recoverableOrders: decisions.filter((decision) => decision.decisionType !== UNRESOLVED_DECISION).flatMap((decision) => decision.referencedOrderNumbers).length,
    affectedOrders: unique(decisions.flatMap((decision) => decision.referencedOrderNumbers)).length,
  };
  return {
    formatVersion: RECOVERY_APPROVAL_VERSION,
    artifactType: RECOVERY_APPROVAL_TYPE,
    snapshot: structuredClone(proposal.snapshot),
    proposalSha256,
    candidateSetSha256: proposal.candidateSetSha256,
    decisions,
    expectedCounts,
    approval: { approved: true, reviewedBy: reviewedBy.trim(), reviewedAt: new Date(reviewedAt).toISOString(), reason: reason.trim() },
  };
}

export function validateRecoveryApprovalV3({ approval, proposal, proposalSha256, shopId }) {
  const issues = [];
  const fail = (code) => issues.push({ code });
  if (!object(approval) || approval.formatVersion !== RECOVERY_APPROVAL_VERSION || approval.artifactType !== RECOVERY_APPROVAL_TYPE) return [{ code: "invalid-recovery-approval-format" }];
  if (approval?.approval?.approved !== true || !nonblank(approval?.approval?.reviewedBy) || !nonblank(approval?.approval?.reason) || Number.isNaN(Date.parse(approval?.approval?.reviewedAt))) fail("unapproved-recovery-artifact");
  if (approval?.snapshot?.shopId !== shopId) fail("recovery-approval-shop-mismatch");
  if (!exact(approval?.snapshot, proposal?.snapshot)) fail("recovery-approval-snapshot-mismatch");
  if (approval?.proposalSha256 !== proposalSha256) fail("recovery-approval-proposal-hash-mismatch");
  if (approval?.candidateSetSha256 !== proposal?.candidateSetSha256) fail("recovery-approval-candidate-set-mismatch");
  const candidates = new Map([...(proposal?.candidates ?? []), ...(proposal?.unresolvedCandidates ?? [])].map((candidate) => [candidate.candidateId, candidate]));
  if (!Array.isArray(approval?.decisions) || approval.decisions.length !== candidates.size) fail("recovery-approval-decision-count-mismatch");
  const seen = new Set();
  for (const decision of approval?.decisions ?? []) {
    const candidate = candidates.get(decision?.candidateId);
    if (!candidate || seen.has(decision.candidateId)) { fail("unknown-or-duplicate-recovery-decision"); continue; }
    seen.add(decision.candidateId);
    if (decision.candidateEvidenceSha256 !== candidate.evidenceSha256 || !exact(decision.referencedOrderNumbers, candidate.referencedOrderNumbers) || decision.vehicleEvidenceSha256 !== evidenceHash(candidate.vehicleEvidence) || decision.decisionType !== candidate.candidateType) fail("recovery-decision-evidence-mismatch");
    try {
      if (!exact(decision, approvedDecision(candidate, decision))) fail("recovery-decision-content-mismatch");
    } catch {
      fail("invalid-recovery-decision-content");
    }
  }
  if (seen.size !== candidates.size) fail("missing-reviewed-recovery-decision");
  const counts = approval?.expectedCounts;
  const decisions = approval.decisions ?? [];
  const expectedCounts = {
    aliases: decisions.filter((decision) => decision.decisionType === ALIAS_DECISION).length,
    recoveredCustomers: decisions.filter((decision) => [CREATE_DECISION, UNKNOWN_DECISION].includes(decision.decisionType)).length,
    historicalUnknown: decisions.filter((decision) => decision.decisionType === UNKNOWN_DECISION).length,
    unresolved: decisions.filter((decision) => decision.decisionType === UNRESOLVED_DECISION).length,
    recoverableOrders: decisions.filter((decision) => decision.decisionType !== UNRESOLVED_DECISION).flatMap((decision) => decision.referencedOrderNumbers ?? []).length,
    affectedOrders: unique(decisions.flatMap((decision) => decision.referencedOrderNumbers ?? [])).length,
  };
  if (!exact(counts, expectedCounts)) fail("recovery-approval-count-mismatch");
  return issues;
}

export function approvalToLegacyRecoveryManifest(approval) {
  const aliasDecisions = approval.decisions.filter((decision) => decision.decisionType === ALIAS_DECISION);
  const customerDecisions = approval.decisions.filter((decision) => [CREATE_DECISION, UNKNOWN_DECISION].includes(decision.decisionType));
  const unresolvedDecisions = approval.decisions.filter((decision) => decision.decisionType === UNRESOLVED_DECISION);
  return {
    manifestVersion: "2.0.0",
    sourceBinding: { sourceFingerprint: approval.snapshot.combinedSourceFingerprint, shopId: approval.snapshot.shopId, sourceTables: [...RECOVERY_RELEVANT_FILES] },
    snapshotBinding: { snapshotDate: approval.snapshot.snapshotDate, zipSha256: approval.snapshot.zipSha256, applicationRoot: approval.snapshot.applicationRoot, dataDirectory: approval.snapshot.dataDirectory },
    expectedCounts: { aliases: aliasDecisions.length, recoveredCustomers: customerDecisions.length, unresolved: unresolvedDecisions.length, recoverableOrders: [...aliasDecisions, ...customerDecisions].flatMap((decision) => decision.referencedOrderNumbers).length },
    existingCustomerAliases: aliasDecisions.map((decision) => ({
      legacyCustomerId: decision.legacyCustomerId,
      existingCustomerLegacyId: decision.existingCustomerLegacyId,
      normalizedName: decision.normalizedName,
      normalizedAddress: decision.normalizedAddress,
      matchingMethod: decision.matchingMethod,
      confidence: decision.confidence,
      reviewStatus: "approved",
      notes: decision.reason,
      applicableLegacyOrderNumbers: decision.referencedOrderNumbers,
    })),
    customersToCreate: customerDecisions.map((decision) => ({
      legacyCustomerId: decision.legacyCustomerId,
      displayName: decision.displayName,
      classification: decision.classification,
      reviewStatus: "approved",
      notes: decision.reason,
      phone: decision.phone,
      alternatePhone: decision.alternatePhone,
      address: decision.address,
      city: decision.city,
      state: decision.state,
      postalCode: decision.postalCode,
      associatedLegacyVehicleIds: decision.associatedLegacyVehicleIds,
      applicableLegacyOrderNumbers: decision.referencedOrderNumbers,
      sourceEvidence: decision.sourceEvidence,
    })),
    unresolvedOrders: unresolvedDecisions.map((decision) => ({
      legacyOrderNumber: decision.legacyOrderNumber,
      legacyCustomerId: decision.legacyCustomerId,
      total: decision.total,
      reason: decision.reason,
      disposition: decision.disposition,
      reviewStatus: "approved-skip",
    })),
  };
}

export async function loadAndValidateRecoveryApprovalV3({ approvalPath, proposalPath, snapshotManifestPath, shopId, repositoryRoot = process.cwd() }) {
  const [loadedApproval, loadedProposal, reconstructedProposal] = await Promise.all([
    readablePrivateJson(approvalPath, "Customer recovery approval", repositoryRoot),
    readablePrivateJson(proposalPath, "Customer recovery proposal", repositoryRoot),
    buildRecoveryProposal({ snapshotManifestPath, shopId, generatedAt: "excluded-from-validation", repositoryRoot }),
  ]);
  const proposalIssues = validateProposalStructure(loadedProposal.value);
  if (proposalIssues.length) throw new Error(`Customer recovery proposal rejected: ${proposalIssues[0].code}.`);
  const comparableLoaded = structuredClone(loadedProposal.value);
  const comparableReconstructed = structuredClone(reconstructedProposal);
  delete comparableLoaded.generatedAt;
  delete comparableReconstructed.generatedAt;
  if (!exact(comparableLoaded, comparableReconstructed)) throw new Error("Customer recovery proposal no longer matches the selected immutable snapshot.");
  const issues = validateRecoveryApprovalV3({ approval: loadedApproval.value, proposal: loadedProposal.value, proposalSha256: loadedProposal.sha256, shopId });
  if (issues.length) throw new Error(`Customer recovery approval rejected: ${issues[0].code}.`);
  return { ...loadedApproval, proposal: loadedProposal.value, proposalPath: loadedProposal.path, legacyManifest: approvalToLegacyRecoveryManifest(loadedApproval.value), deterministicProposalHash: evidenceHash(comparableLoaded) };
}

export async function createRecoveryApproval(options) {
  const [proposalFile, reviewedFile] = await Promise.all([
    readablePrivateJson(options.proposalPath, "Customer recovery proposal", options.repositoryRoot),
    readablePrivateJson(options.reviewedDecisionsPath, "Reviewed Customer recovery decisions", options.repositoryRoot),
  ]);
  const reconstructed = await buildRecoveryProposal({
    snapshotManifestPath: options.snapshotManifestPath,
    shopId: proposalFile.value?.snapshot?.shopId,
    generatedAt: "excluded-from-validation",
    repositoryRoot: options.repositoryRoot,
  });
  const comparableProposal = structuredClone(proposalFile.value);
  const comparableReconstructed = structuredClone(reconstructed);
  delete comparableProposal.generatedAt;
  delete comparableReconstructed.generatedAt;
  if (!exact(comparableProposal, comparableReconstructed)) throw new Error("Proposal does not match the selected immutable snapshot.");
  const approval = buildRecoveryApprovalV3({
    proposal: proposalFile.value,
    proposalSha256: proposalFile.sha256,
    reviewed: reviewedFile.value,
    reviewedBy: options.reviewedBy,
    reviewedAt: options.reviewedAt,
    reason: options.reason,
  });
  const output = await atomicPrivateJsonWrite(options.output, approval, options.repositoryRoot);
  return { approval, output, proposalSha256: proposalFile.sha256 };
}

export function snapshotRelativeSourcePath(snapshotRoot, sourcePath) {
  return relative(snapshotRoot, sourcePath).split(sep).join("/");
}
