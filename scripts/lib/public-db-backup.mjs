import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export const PUBLIC_BACKUP_FORMAT_VERSION = 2;
export const PUBLIC_BACKUP_TYPE = "plumworks-public-schema-custom-dump";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function databaseIdentityFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !databaseName) throw new Error("Database URL must include a hostname and database name.");
  const port = url.port || "5432";
  const redactedTarget = `${url.hostname}:${port}/${databaseName}`;
  return { hostname: url.hostname, port, databaseName, redactedTarget, fingerprint: sha256(redactedTarget) };
}

export function expectedPublicTablesFromPrisma(schemaText) {
  const tables = [];
  for (const model of schemaText.matchAll(/model\s+\w+\s*\{([\s\S]*?)\n\}/g)) {
    const mapped = model[1].match(/@@map\("([^"]+)"\)/)?.[1];
    if (!mapped) throw new Error("Every persisted Prisma model must declare @@map for backup inventory validation.");
    tables.push(mapped);
  }
  return [...new Set(["_prisma_migrations", ...tables])].sort();
}

export function parseArchiveList(text) {
  const tables = new Set();
  const tableData = new Set();
  const rowSecurity = new Set();
  const sequences = new Set();
  const acls = new Set();
  let publicSchema = false;
  let indexCount = 0;
  let constraintCount = 0;
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[3] === "SCHEMA" && fields[5] === "public") publicSchema = true;
    if (fields[3] === "TABLE" && fields[4] === "public") tables.add(fields[5]);
    if (fields[3] === "TABLE" && fields[4] === "DATA" && fields[5] === "public") tableData.add(fields[6]);
    if (fields[3] === "ROW" && fields[4] === "SECURITY" && fields[5] === "public") rowSecurity.add(fields[6]);
    if (fields[3] === "SEQUENCE" && fields[4] === "public") sequences.add(fields[5]);
    const aclTable = line.match(/\bACL\b.*\bTABLE\b\s+public\s+(\S+)/)?.[1];
    if (aclTable) acls.add(aclTable);
    if (fields[3] === "INDEX" && fields[4] === "public") indexCount += 1;
    if (fields[3] === "CONSTRAINT" && fields[4] === "public") constraintCount += 1;
  }
  return { publicSchema, tables, tableData, rowSecurity, sequences, acls, indexCount, constraintCount };
}

export function validatePrivilegeMatrix(matrix, expectedTables) {
  const operations = ["SELECT", "INSERT", "UPDATE", "DELETE"];
  for (const table of expectedTables) {
    const roles = matrix?.[table];
    if (!roles) throw new Error(`Privilege baseline is missing ${table}.`);
    for (const role of ["anon", "authenticated", "PUBLIC"]) {
      for (const operation of operations) {
        if (roles[role]?.[operation] !== false) throw new Error(`Forbidden ${role} ${operation} privilege exists on ${table}.`);
      }
    }
    for (const operation of operations) {
      const expected = table === "_prisma_migrations" ? false : true;
      if (roles.service_role?.[operation] !== expected) throw new Error(`service_role ${operation} privilege on ${table} does not match the established security model.`);
    }
  }
  return true;
}

function exactSet(label, actual, expected) {
  const missing = expected.filter((item) => !actual.has(item));
  const unexpected = [...actual].filter((item) => !expected.includes(item));
  if (missing.length || unexpected.length) {
    throw new Error(`${label} inventory mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}].`);
  }
}

export function validateArchiveEvidence({ archiveText, expectedTables, expectedRlsTables, expectedSequences, expectedAclTables = [] }) {
  const archive = parseArchiveList(archiveText);
  if (!archive.publicSchema) throw new Error("Archive does not contain the public schema.");
  exactSet("Public table", archive.tables, expectedTables);
  exactSet("Public table-data", archive.tableData, expectedTables);
  if (!archive.tables.has("_prisma_migrations")) throw new Error("Archive is missing _prisma_migrations.");
  for (const table of expectedRlsTables) {
    if (!archive.rowSecurity.has(table)) throw new Error(`Archive is missing RLS enablement for ${table}.`);
  }
  exactSet("Public sequence", archive.sequences, expectedSequences);
  exactSet("Public table ACL", archive.acls, expectedAclTables);
  if (archive.indexCount < 1) throw new Error("Archive contains no public indexes.");
  if (archive.constraintCount < 1) throw new Error("Archive contains no public constraints.");
  return archive;
}

export function validateBackupManifest({ manifest, dumpFilename, dumpBytes, dumpSha256, expectedIdentity, expectedShopId, expectedTables }) {
  if (manifest.formatVersion !== PUBLIC_BACKUP_FORMAT_VERSION || manifest.backupType !== PUBLIC_BACKUP_TYPE) throw new Error("Unsupported backup manifest format/type.");
  if (manifest.verification?.status !== "passed") throw new Error("Backup manifest is not verified.");
  if (manifest.backupFilename !== dumpFilename) throw new Error("Backup filename does not match manifest.");
  if (!Number.isSafeInteger(manifest.byteSize) || manifest.byteSize <= 0 || manifest.byteSize !== dumpBytes) throw new Error("Backup byte size does not match manifest.");
  if (manifest.sha256 !== dumpSha256) throw new Error("Backup checksum does not match manifest.");
  if (manifest.database?.fingerprint !== expectedIdentity.fingerprint || manifest.database?.databaseName !== expectedIdentity.databaseName || manifest.database?.redactedTarget !== expectedIdentity.redactedTarget) throw new Error("Backup database identity does not match target invocation.");
  if (manifest.shop?.id !== expectedShopId) throw new Error("Backup Shop identity does not match target invocation.");
  if (!manifest.shop?.name) throw new Error("Backup Shop name is missing.");
  if (manifest.prismaMigrationStatus !== "up-to-date") throw new Error("Backup Prisma migration status is not up to date.");
  if (!manifest.prismaMigrations || manifest.prismaMigrations.count < 1 || !manifest.prismaMigrations.controlSha256) throw new Error("Backup migration control is missing or invalid.");
  if (!manifest.rowCounts || Object.keys(manifest.rowCounts).length !== expectedTables.length) throw new Error("Backup row counts are incomplete.");
  if (manifest.boundaries?.ownersIncluded !== false || manifest.boundaries?.privilegesIncluded !== true) throw new Error("Backup ownership/privilege boundary is invalid.");
  if (!manifest.privilegeMatrix || Object.keys(manifest.privilegeMatrix).length !== expectedTables.length) throw new Error("Backup privilege baseline is incomplete.");
  validatePrivilegeMatrix(manifest.privilegeMatrix, expectedTables);
  if (!Array.isArray(manifest.aclTables)) throw new Error("Backup ACL inventory is missing.");
  for (const table of manifest.aclTables) if (!expectedTables.includes(table)) throw new Error(`Backup ACL inventory contains unexpected table ${table}.`);
  exactSet("Manifest public table", new Set(manifest.publicTables ?? []), expectedTables);
  for (const table of expectedTables) if (!/^\d+$/.test(String(manifest.rowCounts[table]))) throw new Error(`Backup row count is invalid for ${table}.`);
  return true;
}

export function validatePostRestoreControls({ manifest, controls, expectedTables, policyCount, membershipOrphanCount }) {
  for (const table of expectedTables) if (controls.rowCounts?.[table] !== manifest.rowCounts?.[table]) throw new Error(`Post-restore row-count mismatch for ${table}.`);
  if (JSON.stringify(controls.rlsTables) !== JSON.stringify(expectedTables)) throw new Error("Post-restore RLS table inventory mismatch.");
  if (controls.prismaMigrations?.controlSha256 !== manifest.prismaMigrations?.controlSha256) throw new Error("Post-restore Prisma migration control mismatch.");
  if (controls.shop?.nextRepairOrderNumber !== manifest.shop?.nextRepairOrderNumber) throw new Error("Post-restore Shop counter mismatch.");
  if (JSON.stringify(controls.financialControls) !== JSON.stringify(manifest.financialControls)) throw new Error("Post-restore financial controls mismatch.");
  if (JSON.stringify(controls.extensions) !== JSON.stringify(manifest.extensions ?? [])) throw new Error("Post-restore extension inventory mismatch.");
  if (policyCount !== 0) throw new Error("Unexpected public application RLS policies exist after restore.");
  if (JSON.stringify(controls.privilegeMatrix) !== JSON.stringify(manifest.privilegeMatrix)) throw new Error("Post-restore privilege matrix mismatch.");
  validatePrivilegeMatrix(controls.privilegeMatrix, expectedTables);
  if (membershipOrphanCount !== 0) throw new Error("A restored ShopMembership has no matching Supabase Auth user.");
  return true;
}

const validGates = new WeakSet();

export function issueVerifiedBackupGate(binding) {
  const gate = Object.freeze({ ...binding, invocationNonce: randomUUID() });
  validGates.add(gate);
  return gate;
}

export function requireVerifiedBackupGate(gate, { databaseFingerprint, shopId }) {
  if (!gate || !validGates.has(gate)) throw new Error("Destructive reset requires a verified backup from this cutover invocation.");
  if (gate.databaseFingerprint !== databaseFingerprint || gate.shopId !== shopId) throw new Error("Verified backup is bound to a different database or Shop.");
  return true;
}

export async function loadExpectedPublicTables(schemaPath) {
  return expectedPublicTablesFromPrisma(await readFile(schemaPath, "utf8"));
}
