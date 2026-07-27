import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { reconcileCustomerVehicleRows } from "./customer-vehicle-transform.mjs";
import {
  CUTOVER_RECOVERY_FORMAT_VERSION,
  CUTOVER_RECOVERY_SOURCE_TABLES,
  planCutoverCustomerRecovery,
  validateCutoverRecoveryManifestBinding,
} from "./legacy-customer-recovery.mjs";
import { resolveLegacySource } from "./legacy-source.mjs";
import { inspectDbf, inspectLaborMemo, REQUIRED_LEGACY_FILES } from "../legacy-snapshot-intake.mjs";

export const LEGACY_RECOVERY_V1_VERSION = "1.0.0";
export const RECOVERY_UPGRADE_CONFIRMATION = "WRITE_RECOVERY_MANIFEST_V2";

function value(args, name) {
  const positions = args.flatMap((item, index) => item === name ? [index] : []);
  if (positions.length !== 1) throw new Error(`${name} must be provided exactly once.`);
  const result = args[positions[0] + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value.`);
  return result;
}

export function parseRecoveryUpgradeArguments(args) {
  const allowed = new Set(["--input", "--snapshot-manifest", "--shop-id", "--output", "--dry-run", "--confirm"]);
  for (const item of args) if (item.startsWith("--") && !allowed.has(item)) throw new Error(`Unknown argument: ${item}`);
  for (const flag of ["--dry-run"]) if (args.filter((item) => item === flag).length > 1) throw new Error(`${flag} may be supplied only once.`);
  const input = value(args, "--input");
  const snapshotManifest = value(args, "--snapshot-manifest");
  const shopId = value(args, "--shop-id");
  const output = value(args, "--output");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shopId)) throw new Error("--shop-id must be a valid UUID.");
  const confirms = args.flatMap((item, index) => item === "--confirm" ? [index] : []);
  if (confirms.length > 1) throw new Error("--confirm may be supplied only once.");
  const confirmation = confirms.length ? args[confirms[0] + 1] : null;
  if (confirms.length && confirmation !== RECOVERY_UPGRADE_CONFIRMATION) throw new Error(`--confirm must equal ${RECOVERY_UPGRADE_CONFIRMATION}.`);
  if (args.includes("--dry-run") && confirmation) throw new Error("--dry-run cannot be combined with confirmed output creation.");
  return { input, snapshotManifest, shopId, output, confirmedWrite: confirmation === RECOVERY_UPGRADE_CONFIRMATION, dryRun: confirmation !== RECOVERY_UPGRADE_CONFIRMATION };
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value); }
function nonblank(value) { return typeof value === "string" && value.trim().length > 0; }
function unique(values) { return new Set(values).size === values.length; }

export function validateLegacyRecoveryV1(manifest) {
  const issues = [];
  if (!object(manifest)) return [{ code: "malformed-v1-manifest" }];
  if (manifest.manifestVersion !== LEGACY_RECOVERY_V1_VERSION) issues.push({ code: "wrong-v1-format-version" });
  if (manifest.clientSlug !== "cardoc") issues.push({ code: "wrong-v1-client" });
  for (const field of ["generatedAt", "sourceDescription"]) if (!nonblank(manifest[field])) issues.push({ code: `missing-v1-${field}` });
  const aliases = Array.isArray(manifest.existingCustomerAliases) ? manifest.existingCustomerAliases : [];
  const customers = Array.isArray(manifest.customersToCreate) ? manifest.customersToCreate : [];
  const unresolved = Array.isArray(manifest.unresolvedOrders) ? manifest.unresolvedOrders : [];
  if (!Array.isArray(manifest.existingCustomerAliases) || !Array.isArray(manifest.customersToCreate) || !Array.isArray(manifest.unresolvedOrders)) issues.push({ code: "missing-v1-entry-arrays" });
  if (aliases.length !== 6 || customers.length !== 12 || unresolved.length !== 1) issues.push({ code: "wrong-v1-entry-counts" });
  for (const entry of aliases) {
    if (!object(entry) || !["legacyCustomerId", "existingCustomerId", "existingCustomerLegacyId", "normalizedName", "normalizedAddress", "matchingMethod", "confidence", "reviewStatus", "notes"].every((field) => nonblank(entry[field])) ||
      entry.matchingMethod !== "exact-normalized-name-address" || entry.confidence !== "deterministic" || !["pending", "approved"].includes(entry.reviewStatus) ||
      !Array.isArray(entry.applicableLegacyOrderNumbers) || !entry.applicableLegacyOrderNumbers.every(nonblank) || !unique(entry.applicableLegacyOrderNumbers)) issues.push({ code: "malformed-v1-alias" });
  }
  for (const entry of customers) {
    if (!object(entry) || !["legacyCustomerId", "displayName", "classification", "reviewStatus", "notes"].every((field) => nonblank(entry[field])) ||
      !["normal-historical", "historical-unknown"].includes(entry.classification) || !["pending", "approved"].includes(entry.reviewStatus) ||
      !Array.isArray(entry.associatedLegacyVehicleIds) || !Array.isArray(entry.applicableLegacyOrderNumbers) || !object(entry.sourceEvidence) ||
      !entry.associatedLegacyVehicleIds.every(nonblank) || !entry.applicableLegacyOrderNumbers.every(nonblank) || !unique(entry.applicableLegacyOrderNumbers)) issues.push({ code: "malformed-v1-customer" });
  }
  for (const entry of unresolved) {
    if (!object(entry) || !["legacyOrderNumber", "legacyCustomerId", "total", "reason", "disposition", "reviewStatus"].every((field) => nonblank(entry[field])) || entry.disposition !== "keep-skipped" || entry.reviewStatus !== "approved-skip") issues.push({ code: "malformed-v1-unresolved" });
  }
  const recoveryIds = [...aliases, ...customers].map((entry) => entry.legacyCustomerId?.trim().toUpperCase()).filter(Boolean);
  const orders = [...aliases, ...customers].flatMap((entry) => entry.applicableLegacyOrderNumbers ?? []);
  if (!unique(recoveryIds)) issues.push({ code: "duplicate-v1-recovery-identity" });
  if (!unique(orders)) issues.push({ code: "duplicate-v1-recoverable-order" });
  if (orders.length !== 65) issues.push({ code: "wrong-v1-recoverable-order-count" });
  const aliasTargets = new Map();
  for (const entry of aliases) {
    const previous = aliasTargets.get(entry.legacyCustomerId);
    if (previous && previous !== entry.existingCustomerLegacyId) issues.push({ code: "conflicting-v1-alias-target" });
    aliasTargets.set(entry.legacyCustomerId, entry.existingCustomerLegacyId);
  }
  return issues;
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function readableJson(path, label) {
  const resolved = resolve(path);
  await access(resolved, constants.R_OK);
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} must be a readable regular file.`);
  try { return { path: resolved, bytes: await readFile(resolved), value: JSON.parse(await readFile(resolved, "utf8")) }; }
  catch { throw new Error(`${label} must contain valid JSON.`); }
}

function comparableDbf(metadata) {
  return {
    versionByte: metadata.versionByte, codePageMarker: metadata.codePageMarker, headerLength: metadata.headerLength,
    recordLength: metadata.recordLength, declaredRowCount: metadata.declaredRowCount,
    physicallyReadableRowCount: metadata.physicallyReadableRowCount, activeRowCount: metadata.activeRowCount,
    sourceDeletedRowCount: metadata.sourceDeletedRowCount, malformedOrTruncatedRowCount: metadata.malformedOrTruncatedRowCount,
    memoFieldPresent: metadata.memoFieldPresent, fields: metadata.fields,
  };
}

export async function validateSnapshotManifestForRecovery({ manifestPath, repositoryRoot = process.cwd() }) {
  const loaded = await readableJson(manifestPath, "Snapshot manifest");
  const manifest = loaded.value;
  if (manifest.formatVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.snapshotDate) || !/^[0-9a-f]{64}$/.test(manifest.zipSha256) ||
    !nonblank(manifest.detectedApplicationRoot) || !nonblank(manifest.detectedDataDirectory) || manifest.requiredFileValidation?.valid !== true ||
    !Array.isArray(manifest.requiredFileValidation?.required) || !REQUIRED_LEGACY_FILES.every((file) => manifest.requiredFileValidation.required.includes(file)) ||
    !Array.isArray(manifest.fatalIssues) || manifest.fatalIssues.length) throw new Error("Snapshot manifest is incomplete or invalid for recovery binding.");
  const snapshotRoot = dirname(loaded.path);
  const dataDirectory = resolve(snapshotRoot, manifest.detectedDataDirectory);
  if (!isWithin(snapshotRoot, dataDirectory)) throw new Error("Snapshot manifest data directory escapes the immutable snapshot.");
  const source = await resolveLegacySource({ args: ["--source", dataDirectory], requiredFiles: REQUIRED_LEGACY_FILES, repositoryRoot });
  for (const expected of REQUIRED_LEGACY_FILES.filter((file) => file.endsWith(".DBF"))) {
    const actualMetadata = comparableDbf(await inspectDbf(source.files[expected]));
    if (JSON.stringify(actualMetadata) !== JSON.stringify(comparableDbf(manifest.dbfTables?.[expected] ?? {}))) throw new Error(`Snapshot DBF metadata mismatch: ${expected}.`);
  }
  const memo = await inspectLaborMemo(source.files["laborfinal.FPT"]);
  if (JSON.stringify(memo) !== JSON.stringify(manifest.laborMemo)) throw new Error("Snapshot labor memo metadata mismatch.");
  for (const expected of REQUIRED_LEGACY_FILES) {
    const relativePath = relative(snapshotRoot, source.files[expected]).split(sep).join("/");
    const file = manifest.files?.[relativePath];
    if (!file || file.sha256 !== source.fingerprints[expected] || file.bytes !== (await stat(source.files[expected])).size) throw new Error(`Snapshot file identity mismatch: ${expected}.`);
  }
  return { manifest, source, snapshotRoot, sourceFingerprint: source.fingerprint };
}

const decoder = new TextDecoder("windows-1252");
function fieldValue(bytes, type) {
  if (["C", "N", "F", "D"].includes(type)) return decoder.decode(bytes).trim() || null;
  if (type === "I" && bytes.length === 4) return bytes.readInt32LE();
  return null;
}
function identifier(rawData, candidates) {
  const entry = Object.entries(rawData).find(([key]) => candidates.includes(key.toUpperCase().replaceAll("_", "")));
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}
export async function readRecoveryDbf(path) {
  const file = await readFile(path);
  const count = file.readUInt32LE(4), headerLength = file.readUInt16LE(8), recordLength = file.readUInt16LE(10);
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32), end = descriptor.indexOf(0);
    fields.push({ name: decoder.decode(descriptor.subarray(0, end === -1 ? 11 : end)).trim(), type: String.fromCharCode(descriptor[11]), length: descriptor[16], recordOffset });
    recordOffset += descriptor[16];
  }
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const record = file.subarray(headerLength + index * recordLength, headerLength + (index + 1) * recordLength);
    if (record[0] === 0x2a) continue;
    const rawData = Object.fromEntries(fields.map((field) => [field.name, fieldValue(record.subarray(field.recordOffset, field.recordOffset + field.length), field.type)]));
    rows.push({ rawData, legacyCustno: identifier(rawData, ["CUSTNO", "CUSTOMERNO"]), legacyCarno: identifier(rawData, ["CARNO", "VEHICLENO"]), legacyRoNo: identifier(rawData, ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO", "INVNUM"]) });
  }
  return rows;
}

export async function loadSnapshotRecoveryEvidence(snapshot) {
  const [customers, vehicles, finalRows, arRows] = await Promise.all([
    readRecoveryDbf(snapshot.source.files["Cust.DBF"]), readRecoveryDbf(snapshot.source.files["vehicles.DBF"]),
    readRecoveryDbf(snapshot.source.files["FINAL.DBF"]), readRecoveryDbf(snapshot.source.files["ar.DBF"]),
  ]);
  const transformed = reconcileCustomerVehicleRows(customers, vehicles);
  return {
    stagedCustomers: transformed.customers.map((customer) => ({ ...customer, id: `projected-normal:${customer.legacyCustno}` })),
    stagedVehicles: transformed.vehicles,
    sourceCustomerReferences: transformed.customers,
    sourceInvoiceArReferences: [
      ...finalRows.map((row) => ({ legacyRoNo: row.legacyRoNo, legacyCustno: row.legacyCustno, total: row.rawData?.TOTAL, sourceTable: "FINAL.DBF" })),
      ...arRows.map((row) => ({ legacyRoNo: row.legacyRoNo, legacyCustno: row.legacyCustno, total: row.rawData?.TOTAL, sourceTable: "ar.DBF" })),
    ],
  };
}

export function buildRecoveryManifestV2({ inputManifest, inputSha256, snapshot, shopId, createdAt }) {
  const aliases = inputManifest.existingCustomerAliases;
  const customers = inputManifest.customersToCreate;
  const unresolved = inputManifest.unresolvedOrders;
  return {
    ...structuredClone(inputManifest),
    manifestVersion: CUTOVER_RECOVERY_FORMAT_VERSION,
    createdAt,
    sourceBinding: { sourceFingerprint: snapshot.sourceFingerprint, shopId, sourceTables: [...CUTOVER_RECOVERY_SOURCE_TABLES] },
    snapshotBinding: {
      snapshotDate: snapshot.manifest.snapshotDate, zipSha256: snapshot.manifest.zipSha256,
      applicationRoot: snapshot.manifest.detectedApplicationRoot, dataDirectory: snapshot.manifest.detectedDataDirectory,
    },
    expectedCounts: {
      aliases: aliases.length, recoveredCustomers: customers.length, unresolved: unresolved.length,
      recoverableOrders: [...aliases, ...customers].flatMap((entry) => entry.applicableLegacyOrderNumbers).length,
    },
    upgradeProvenance: { inputManifestVersion: inputManifest.manifestVersion, inputManifestSha256: inputSha256 },
  };
}

function summary(proposal, plan, inputSha256) {
  return {
    oldFormatVersion: LEGACY_RECOVERY_V1_VERSION, proposedFormatVersion: CUTOVER_RECOVERY_FORMAT_VERSION,
    inputManifestSha256: inputSha256, sourceFingerprintMatch: true, shopMatch: true,
    recoveredCustomers: proposal.expectedCounts.recoveredCustomers, aliases: proposal.expectedCounts.aliases,
    approvedUnresolved: proposal.expectedCounts.unresolved, recoverableOrders: proposal.expectedCounts.recoverableOrders,
    satisfiedEntries: proposal.expectedCounts.aliases + proposal.expectedCounts.recoveredCustomers + proposal.expectedCounts.unresolved - plan.staleManifestEntries.length,
    staleEntries: plan.staleManifestEntries.length,
    collisions: plan.collisions.length, unexpectedUnresolved: plan.unexpectedUnresolved.length, fatalIssues: plan.fatalIssues.length,
    referenceDiagnostics: plan.referenceDiagnostics,
  };
}

async function atomicWrite(path, value) {
  const output = resolve(path);
  try { await lstat(output); throw new Error("Output manifest already exists."); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const temporaryDirectory = await mkdtemp(join(dirname(output), `.${basename(output)}-tmp-`));
  const temporary = join(temporaryDirectory, basename(output));
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, output);
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
}

export async function runRecoveryUpgrade(options, dependencies = {}) {
  const input = await readableJson(options.input, "Input recovery manifest");
  const inputSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const inputIssues = validateLegacyRecoveryV1(input.value);
  if (inputIssues.length) throw new Error(`Version 1 recovery manifest validation failed: ${inputIssues[0].code}.`);
  const declaredInputShopId = input.value.shopId ?? input.value.sourceBinding?.shopId ?? null;
  if (declaredInputShopId && declaredInputShopId !== options.shopId) throw new Error("Input recovery manifest shop identity conflicts with --shop-id.");
  const snapshot = await (dependencies.snapshotValidator ?? validateSnapshotManifestForRecovery)({ manifestPath: options.snapshotManifest, repositoryRoot: dependencies.repositoryRoot });
  const proposal = buildRecoveryManifestV2({ inputManifest: input.value, inputSha256, snapshot, shopId: options.shopId, createdAt: (dependencies.now ?? (() => new Date()))().toISOString() });
  const bindingIssues = validateCutoverRecoveryManifestBinding({ manifest: proposal, shopId: options.shopId, sourceFingerprint: snapshot.sourceFingerprint });
  if (bindingIssues.length) throw new Error(`Version 2 recovery manifest validation failed: ${bindingIssues[0].code}.`);
  const evidence = await (dependencies.evidenceLoader ?? loadSnapshotRecoveryEvidence)(snapshot);
  const plan = planCutoverCustomerRecovery({ ...evidence, manifest: proposal, existingAliases: [], shopId: options.shopId, importRunId: `upgrade:${inputSha256}`, sourceFingerprint: snapshot.sourceFingerprint });
  const result = summary(proposal, plan, inputSha256);
  if (plan.staleManifestEntries.length || plan.collisions.length || plan.unexpectedUnresolved.length || plan.fatalIssues.length) throw new Error("Recovery decisions are not compatible with the selected snapshot; human review is required.");
  let writes = 0;
  if (options.confirmedWrite) { await (dependencies.writer ?? atomicWrite)(options.output, proposal); writes = 1; }
  return { proposal, plan, summary: { ...result, outputFileWritesPerformed: writes } };
}
