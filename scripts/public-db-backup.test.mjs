import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PUBLIC_BACKUP_FORMAT_VERSION, PUBLIC_BACKUP_TYPE, databaseIdentityFromUrl,
  expectedPublicTablesFromPrisma, issueVerifiedBackupGate, requireVerifiedBackupGate,
  parseArchiveList, requiredAclTablesFromPrivilegeMatrix, validateArchiveEvidence,
  validateBackupManifest, validatePostRestoreControls, validatePrivilegeMatrix, validateRenderedAclSql,
} from "./lib/public-db-backup.mjs";
import { verifyDirectory } from "./db/public-db-backup.mjs";

const identity = databaseIdentityFromUrl("postgresql://user:secret@db.example.test:5432/postgres");
const tables = ["_prisma_migrations", "shops"];
function manifest(overrides = {}) {
  return {
    formatVersion: PUBLIC_BACKUP_FORMAT_VERSION, backupType: PUBLIC_BACKUP_TYPE,
    backupFilename: "cutover.dump", byteSize: 10, sha256: "abc", database: identity,
    shop: { id: "shop-1", name: "Test Shop" }, publicTables: tables,
    prismaMigrationStatus: "up-to-date",
    rowCounts: { _prisma_migrations: "3", shops: "1" },
    prismaMigrations: { count: 3, controlSha256: "control" }, verification: { status: "passed", aclSqlValidated: true },
    privilegeMatrix: privilegeMatrix(), aclTables: ["shops"],
    boundaries: { ownersIncluded: false, privilegesIncluded: true }, ...overrides,
  };
}
function privilegeMatrix() {
  const denied = { SELECT: false, INSERT: false, UPDATE: false, DELETE: false };
  const allowed = { SELECT: true, INSERT: true, UPDATE: true, DELETE: true };
  return {
    _prisma_migrations: { anon: { ...denied }, authenticated: { ...denied }, service_role: { ...denied }, PUBLIC: { ...denied } },
    shops: { anon: { ...denied }, authenticated: { ...denied }, service_role: { ...allowed }, PUBLIC: { ...denied } },
  };
}
const archive = `1; 0 0 SCHEMA - public owner
2; 0 0 TABLE public _prisma_migrations owner
3; 0 0 TABLE public shops owner
4; 0 0 TABLE DATA public _prisma_migrations owner
5; 0 0 TABLE DATA public shops owner
6; 0 0 ROW SECURITY public _prisma_migrations owner
7; 0 0 ROW SECURITY public shops owner
8; 0 0 SEQUENCE public shops_seq owner
9; 0 0 INDEX public shops_pkey owner
10; 0 0 CONSTRAINT public shops shops_pkey owner
11; 0 0 ACL public TABLE shops owner
12; 0 0 ACL - SCHEMA public owner
13; 0 0 TABLE DATA public shops owner`;

test("Prisma schema is the central complete public-table inventory", () => {
  const parsed = expectedPublicTablesFromPrisma('model Shop {\n id String @id\n @@map("shops")\n}');
  assert.deepEqual(parsed, ["_prisma_migrations", "shops"]);
});
test("archive validation requires exact tables, data, migrations, sequences, indexes, constraints, and RLS", () => {
  assert.equal(validateArchiveEvidence({ archiveText: archive, expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"], requiredAclTables: ["shops"], expectedAclTables: ["shops"] }).tables.size, 2);
  assert.throws(() => validateArchiveEvidence({ archiveText: archive.replace("TABLE public shops", "TABLE public other"), expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"] }), /inventory mismatch/);
  assert.throws(() => validateArchiveEvidence({ archiveText: archive.replace("TABLE public _prisma_migrations", "TABLE public migrations"), expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"] }), /_prisma_migrations|inventory mismatch/);
  assert.throws(() => validateArchiveEvidence({ archiveText: "not an archive", expectedTables: tables, expectedRlsTables: tables, expectedSequences: [] }), /public schema/);
});
test("archive validation requires captured ACL entries", () => {
  const withoutTableAcl = archive.split("\n").filter((line) => !line.includes("ACL public TABLE")).join("\n");
  assert.throws(() => validateArchiveEvidence({ archiveText: withoutTableAcl, expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"], requiredAclTables: ["shops"] }), /missing required ACL coverage/);
});
test("real pg_restore ACL grammar is parsed without confusing table data or non-table ACLs", () => {
  const realToc = `4322; 0 0 ACL public TABLE accounts_receivable postgres
4323; 0 0 ACL public TABLE audit_logs postgres
4324; 0 0 ACL public TABLE canned_services postgres
4210; 0 0 TABLE DATA public accounts_receivable postgres
4321; 0 0 ACL - SCHEMA public postgres`;
  assert.deepEqual([...parseArchiveList(realToc).acls], ["accounts_receivable", "audit_logs", "canned_services"]);
});
test("ACL requirements derive from positive non-owner privileges, not relacl state", () => {
  assert.deepEqual(requiredAclTablesFromPrivilegeMatrix(privilegeMatrix(), tables), ["shops"]);
  assert.doesNotThrow(() => validateArchiveEvidence({ archiveText: archive, expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"], requiredAclTables: ["shops"] }));
  assert.equal(privilegeMatrix()._prisma_migrations.service_role.SELECT, false);
});
test("restore archive ACL inventory must match the manifest", () => {
  assert.throws(() => validateArchiveEvidence({ archiveText: archive, expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"], requiredAclTables: ["shops"], expectedAclTables: [] }), /Public table ACL inventory mismatch/);
});
test("rendered ACL SQL must reproduce positive grants and preserve every denial", () => {
  const sql = "GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.shops TO service_role;\n";
  assert.equal(validateRenderedAclSql({ sql, privilegeMatrix: privilegeMatrix(), expectedTables: tables }), true);
  assert.throws(() => validateRenderedAclSql({ sql: "", privilegeMatrix: privilegeMatrix(), expectedTables: tables }), /does not reproduce shops service_role SELECT/);
  assert.throws(() => validateRenderedAclSql({ sql: `${sql}GRANT SELECT ON TABLE public.shops TO anon;\n`, privilegeMatrix: privilegeMatrix(), expectedTables: tables }), /does not reproduce shops anon SELECT/);
  assert.throws(() => validateRenderedAclSql({ sql: `${sql}GRANT SELECT ON TABLE public._prisma_migrations TO service_role;\n`, privilegeMatrix: privilegeMatrix(), expectedTables: tables }), /does not reproduce _prisma_migrations service_role SELECT/);
});
test("manifest rejects checksum, database, Shop, migration, and inventory drift", () => {
  assert.equal(validateBackupManifest({ manifest: manifest(), dumpFilename: "cutover.dump", dumpBytes: 10, dumpSha256: "abc", expectedIdentity: identity, expectedShopId: "shop-1", expectedTables: tables }), true);
  assert.throws(() => validateBackupManifest({ manifest: manifest(), dumpFilename: "cutover.dump", dumpBytes: 10, dumpSha256: "wrong", expectedIdentity: identity, expectedShopId: "shop-1", expectedTables: tables }), /checksum/);
  assert.throws(() => validateBackupManifest({ manifest: manifest(), dumpFilename: "cutover.dump", dumpBytes: 10, dumpSha256: "abc", expectedIdentity: databaseIdentityFromUrl("postgresql://u:p@other.test/db"), expectedShopId: "shop-1", expectedTables: tables }), /database identity/);
  assert.throws(() => validateBackupManifest({ manifest: manifest(), dumpFilename: "cutover.dump", dumpBytes: 10, dumpSha256: "abc", expectedIdentity: identity, expectedShopId: "shop-2", expectedTables: tables }), /Shop identity/);
  assert.throws(() => validateBackupManifest({ manifest: manifest({ byteSize: 0 }), dumpFilename: "cutover.dump", dumpBytes: 0, dumpSha256: "abc", expectedIdentity: identity, expectedShopId: "shop-1", expectedTables: tables }), /byte size/);
});
test("failed or absent backup work cannot issue a reset gate", () => {
  assert.throws(() => requireVerifiedBackupGate(null, { databaseFingerprint: identity.fingerprint, shopId: "shop-1" }), /requires a verified backup/);
});
test("post-restore controls reject count and RLS/security drift", () => {
  const source = manifest({ shop: { id: "shop-1", name: "Test Shop", nextRepairOrderNumber: "20" }, financialControls: { invoice_total: "10.00", paid_total: "5.00", ar_balance: "5.00" }, extensions: [] });
  const controls = { rowCounts: source.rowCounts, rlsTables: tables, prismaMigrations: source.prismaMigrations, shop: source.shop, financialControls: source.financialControls, extensions: [], privilegeMatrix: source.privilegeMatrix };
  assert.equal(validatePostRestoreControls({ manifest: source, controls, expectedTables: tables, policyCount: 0, membershipOrphanCount: 0 }), true);
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls: { ...controls, rowCounts: { ...controls.rowCounts, shops: "2" } }, expectedTables: tables, policyCount: 0, membershipOrphanCount: 0 }), /row-count mismatch/);
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls: { ...controls, rlsTables: ["shops"] }, expectedTables: tables, policyCount: 0, membershipOrphanCount: 0 }), /RLS table inventory/);
  const privilegeDrift = structuredClone(controls); privilegeDrift.privilegeMatrix.shops.service_role.SELECT = false;
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls: privilegeDrift, expectedTables: tables, policyCount: 0, membershipOrphanCount: 0 }), /privilege matrix mismatch/);
});
test("privilege baseline enforces API denial, ordinary service_role DML, and protected migrations", () => {
  const valid = privilegeMatrix();
  assert.equal(validatePrivilegeMatrix(valid, tables), true);
  const missingService = structuredClone(valid); missingService.shops.service_role.SELECT = false;
  assert.throws(() => validatePrivilegeMatrix(missingService, tables), /service_role SELECT/);
  const anonGrant = structuredClone(valid); anonGrant.shops.anon.SELECT = true;
  assert.throws(() => validatePrivilegeMatrix(anonGrant, tables), /Forbidden anon SELECT/);
  const authenticatedGrant = structuredClone(valid); authenticatedGrant.shops.authenticated.UPDATE = true;
  assert.throws(() => validatePrivilegeMatrix(authenticatedGrant, tables), /Forbidden authenticated UPDATE/);
  const publicGrant = structuredClone(valid); publicGrant.shops.PUBLIC.DELETE = true;
  assert.throws(() => validatePrivilegeMatrix(publicGrant, tables), /Forbidden PUBLIC DELETE/);
  const migrationGrant = structuredClone(valid); migrationGrant._prisma_migrations.service_role.SELECT = true;
  assert.throws(() => validatePrivilegeMatrix(migrationGrant, tables), /service_role SELECT.*_prisma_migrations/);
});
test("only an invocation-issued database/shop-bound gate unlocks reset", () => {
  const gate = issueVerifiedBackupGate({ databaseFingerprint: identity.fingerprint, shopId: "shop-1" });
  assert.equal(requireVerifiedBackupGate(gate, { databaseFingerprint: identity.fingerprint, shopId: "shop-1" }), true);
  assert.throws(() => requireVerifiedBackupGate({ ...gate }, { databaseFingerprint: identity.fingerprint, shopId: "shop-1" }), /verified backup/);
  assert.throws(() => requireVerifiedBackupGate(gate, { databaseFingerprint: identity.fingerprint, shopId: "shop-2" }), /different database or Shop/);
});
test("directory verifier rejects multiple archives and unsafe permissions before restore inspection", async (t) => {
  if (process.platform === "win32") return t.skip("POSIX permission test");
  const root = await mkdtemp(join(tmpdir(), "public-backup-test-")); const directory = join(root, "backup"); await mkdir(directory, { mode: 0o700 });
  await Promise.all([writeFile(join(directory, "one.dump"), "x"), writeFile(join(directory, "two.dump"), "x")]);
  await assert.rejects(verifyDirectory({ directory, databaseUrl: "postgresql://u:p@db.test/postgres", shopId: "shop" }), /exactly one/);
  await chmod(join(directory, "two.dump"), 0o600); await chmod(join(directory, "one.dump"), 0o644);
  await import("node:fs/promises").then(({ unlink }) => unlink(join(directory, "two.dump")));
  await assert.rejects(verifyDirectory({ directory, databaseUrl: "postgresql://u:p@db.test/postgres", shopId: "shop" }), /Unsafe permissions/);
});
test("cutover and restore source contracts use only the authoritative archive", async () => {
  const [{ readFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const cutover = await readFile(path.resolve("scripts/legacy-cutover.mjs"), "utf8");
  const restore = await readFile(path.resolve("scripts/db/restore-public-db.sh"), "utf8");
  const backup = await readFile(path.resolve("scripts/db/public-db-backup.mjs"), "utf8");
  assert.doesNotMatch(cutover, /roles\.sql|schema\.sql|data\.sql|supabase.*db.*dump/s);
  assert.match(cutover, /requireVerifiedBackupGate/);
  assert.match(cutover, /resetOperationalData\(prisma, shop\.id, verifiedBackupGate\)/);
  assert.match(restore, /--single-transaction/);
  assert.match(restore, /--no-owner/);
  assert.doesNotMatch(restore, /--no-privileges/);
  assert.match(backup, /"--no-owner"/);
  assert.doesNotMatch(backup, /"--no-privileges"/);
  assert.match(restore, /post-restore/);
  assert.match(restore, /RESTORE_PUBLIC_BASELINE/);
});
test("restore completion is gated by pg_restore and post-restore verification", async () => {
  const { readFile } = await import("node:fs/promises");
  const restore = await readFile("scripts/db/restore-public-db.sh", "utf8");
  const pgStart = restore.indexOf("restore_stage 'pg_restore:start'");
  const pgCommand = restore.indexOf("if pg_restore");
  const pgComplete = restore.indexOf("restore_stage 'pg_restore:complete exit=0'");
  const verifierStart = restore.indexOf("restore_stage 'post-restore-verification:start'");
  const verifierCommand = restore.indexOf('if node "$SCRIPT_DIR/public-db-backup.mjs" post-restore');
  const verifierComplete = restore.indexOf("restore_stage 'post-restore-verification:complete exit=0'");
  const finalComplete = restore.indexOf("restore_stage 'restore:complete exit=0'");
  const successFooter = restore.indexOf("Restore completed successfully.");
  const explicitExit = restore.lastIndexOf("exit 0");
  assert.ok(pgStart < pgCommand && pgCommand < pgComplete);
  assert.ok(pgComplete < verifierStart && verifierStart < verifierCommand && verifierCommand < verifierComplete);
  assert.ok(verifierComplete < finalComplete && finalComplete < successFooter && successFooter < explicitExit);
  assert.match(restore, /pg_restore:failed exit=\$restore_exit[\s\S]*exit "\$restore_exit"/);
  assert.match(restore, /post-restore-verification:failed exit=\$verifier_exit[\s\S]*exit "\$verifier_exit"/);
  assert.doesNotMatch(restore, /pg_restore[^\n]*&|post-restore[^\n]*&|\|\s*tee|\bwait\b|<\(/);
});
test("database helpers close clients and await archive subprocess completion", async () => {
  const { readFile } = await import("node:fs/promises");
  const helper = await readFile("scripts/db/public-db-backup.mjs", "utf8");
  assert.ok((helper.match(/await client\.end\(\)/g) ?? []).length >= 3);
  assert.match(helper, /child\.once\("exit", \(code\)/);
  assert.doesNotMatch(helper, /new PrismaClient|new Pool|setInterval|readline/);
});
