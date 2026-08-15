import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PUBLIC_BACKUP_FORMAT_VERSION, PUBLIC_BACKUP_TYPE, databaseIdentityFromUrl,
  expectedPublicTablesFromPrisma, issueVerifiedBackupGate, requireVerifiedBackupGate,
  validateArchiveEvidence, validateBackupManifest, validatePostRestoreControls,
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
    prismaMigrations: { count: 3, controlSha256: "control" }, verification: { status: "passed" }, ...overrides,
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
10; 0 0 CONSTRAINT public shops shops_pkey owner`;

test("Prisma schema is the central complete public-table inventory", () => {
  const parsed = expectedPublicTablesFromPrisma('model Shop {\n id String @id\n @@map("shops")\n}');
  assert.deepEqual(parsed, ["_prisma_migrations", "shops"]);
});
test("archive validation requires exact tables, data, migrations, sequences, indexes, constraints, and RLS", () => {
  assert.equal(validateArchiveEvidence({ archiveText: archive, expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"] }).tables.size, 2);
  assert.throws(() => validateArchiveEvidence({ archiveText: archive.replace("TABLE public shops", "TABLE public other"), expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"] }), /inventory mismatch/);
  assert.throws(() => validateArchiveEvidence({ archiveText: archive.replace("TABLE public _prisma_migrations", "TABLE public migrations"), expectedTables: tables, expectedRlsTables: tables, expectedSequences: ["shops_seq"] }), /_prisma_migrations|inventory mismatch/);
  assert.throws(() => validateArchiveEvidence({ archiveText: "not an archive", expectedTables: tables, expectedRlsTables: tables, expectedSequences: [] }), /public schema/);
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
  const controls = { rowCounts: source.rowCounts, rlsTables: tables, prismaMigrations: source.prismaMigrations, shop: source.shop, financialControls: source.financialControls, extensions: [] };
  assert.equal(validatePostRestoreControls({ manifest: source, controls, expectedTables: tables, policyCount: 0, forbiddenGrantCount: 0, membershipOrphanCount: 0 }), true);
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls: { ...controls, rowCounts: { ...controls.rowCounts, shops: "2" } }, expectedTables: tables, policyCount: 0, forbiddenGrantCount: 0, membershipOrphanCount: 0 }), /row-count mismatch/);
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls: { ...controls, rlsTables: ["shops"] }, expectedTables: tables, policyCount: 0, forbiddenGrantCount: 0, membershipOrphanCount: 0 }), /RLS table inventory/);
  assert.throws(() => validatePostRestoreControls({ manifest: source, controls, expectedTables: tables, policyCount: 0, forbiddenGrantCount: 1, membershipOrphanCount: 0 }), /Forbidden/);
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
  assert.doesNotMatch(cutover, /roles\.sql|schema\.sql|data\.sql|supabase.*db.*dump/s);
  assert.match(cutover, /requireVerifiedBackupGate/);
  assert.match(cutover, /resetOperationalData\(prisma, shop\.id, verifiedBackupGate\)/);
  assert.match(restore, /--single-transaction/);
  assert.match(restore, /post-restore/);
  assert.match(restore, /RESTORE_PUBLIC_BASELINE/);
});
