import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { expectedPublicTablesFromPrisma, validateArchiveEvidence } from "../scripts/lib/public-db-backup.mjs";

const repoRoot = new URL("../", import.meta.url);
const schema = await readFile(new URL("prisma/schema.prisma", repoRoot), "utf8");
const migrationDirectory = new URL("prisma/migrations/", repoRoot);
const migrationNames = (await readdir(migrationDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const migrations = await Promise.all(migrationNames.map(async (name) => ({
  name,
  sql: await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"),
})));
const correction = migrations.find(({ name }) => name === "20260814120000_enable_invoice_legacy_charges_rls");
const allMigrationSql = migrations.map(({ sql }) => sql).join("\n");

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rlsEnabledFor(table) {
  const quotedTable = `(?:public\\.)?"${escaped(table)}"`;
  const qualifiedQuotedTable = `"public"\\."${escaped(table)}"`;
  return new RegExp(`ALTER\\s+TABLE\\s+(?:${quotedTable}|${qualifiedQuotedTable})\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i").test(allMigrationSql);
}

test("focused migration applies only the approved invoice legacy charge security correction", () => {
  assert.ok(correction);
  assert.equal(correction.sql, `ALTER TABLE public."invoice_legacy_charges"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
  ON TABLE public."invoice_legacy_charges"
  FROM anon, authenticated;
`);
  assert.doesNotMatch(correction.sql, /FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(correction.sql, /CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY/i);
  assert.doesNotMatch(correction.sql, /service_role/i);
  assert.doesNotMatch(correction.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|TABLE)?\s*public\."invoice_legacy_charges"/i);
});

test("invoice legacy charges retain the server-only sibling-table security contract", () => {
  assert.match(correction.sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(correction.sql, /REVOKE\s+ALL\s+PRIVILEGES[\s\S]*FROM\s+anon,\s*authenticated/i);
  assert.doesNotMatch(correction.sql, /\bGRANT\b/i);
  assert.doesNotMatch(correction.sql, /\b(?:FROM|TO)\s+PUBLIC\b/i);
  assert.equal((correction.sql.match(/\bPOLICY\b/gi) ?? []).length, 0);
});

test("every Prisma-managed public application table has RLS enabled by migration history", () => {
  const expectedTables = expectedPublicTablesFromPrisma(schema);
  const missing = expectedTables.filter((table) => !rlsEnabledFor(table));
  assert.deepEqual(missing, []);
});

test("backup archive verification recognizes invoice legacy charges as RLS protected", () => {
  const archive = `1; 0 0 SCHEMA - public owner
2; 0 0 TABLE public _prisma_migrations owner
3; 0 0 TABLE public invoice_legacy_charges owner
4; 0 0 TABLE DATA public _prisma_migrations owner
5; 0 0 TABLE DATA public invoice_legacy_charges owner
6; 0 0 ROW SECURITY public _prisma_migrations owner
7; 0 0 ROW SECURITY public invoice_legacy_charges owner
8; 0 0 SEQUENCE public invoice_legacy_charges_seq owner
9; 0 0 INDEX public invoice_legacy_charges_pkey owner
10; 0 0 CONSTRAINT public invoice_legacy_charges invoice_legacy_charges_pkey owner`;
  const result = validateArchiveEvidence({
    archiveText: archive,
    expectedTables: ["_prisma_migrations", "invoice_legacy_charges"],
    expectedRlsTables: ["_prisma_migrations", "invoice_legacy_charges"],
    expectedSequences: ["invoice_legacy_charges_seq"],
  });
  assert.equal(result.rowSecurity.has("invoice_legacy_charges"), true);
  assert.throws(() => validateArchiveEvidence({
    archiveText: archive.replace("7; 0 0 ROW SECURITY public invoice_legacy_charges owner\n", ""),
    expectedTables: ["_prisma_migrations", "invoice_legacy_charges"],
    expectedRlsTables: ["_prisma_migrations", "invoice_legacy_charges"],
    expectedSequences: ["invoice_legacy_charges_seq"],
  }), /missing RLS enablement for invoice_legacy_charges/);
});
