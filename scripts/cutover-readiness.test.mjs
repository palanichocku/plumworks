import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { commandPlan } from "./dev-database-command.mjs";
import {
  assertNoMigrationManagedOperationalEvidence,
  migrationManagedOperationalCounts,
  MIGRATION_MANAGED_OPERATIONAL_TABLES,
} from "./lib/legacy-cutover-reset.mjs";
import {
  MIGRATION_MANAGED_PUBLIC_TABLES,
  expectedPublicTablesFromPrisma,
  loadExpectedPublicTables,
} from "./lib/public-db-backup.mjs";

const evidenceTables = [
  "authorization_events",
  "authorization_requests",
  "document_revisions",
  "signature_evidence",
];

const serverOnlyConfigurationTables = [
  "shop_security_settings",
  "shop_signature_defaults",
];

test("backup inventory declares all migration-managed public tables", () => {
  assert.deepEqual(
    [...MIGRATION_MANAGED_PUBLIC_TABLES].sort(),
    [...evidenceTables, ...serverOnlyConfigurationTables].sort(),
  );
  assert.deepEqual(
    expectedPublicTablesFromPrisma('model Shop {\n id String @id\n @@map("shops")\n}'),
    ["_prisma_migrations", "shops"],
  );
});

test("backup and RLS inventory covers migration-managed shop security configuration", () => {
  assert.deepEqual(
    [...MIGRATION_MANAGED_PUBLIC_TABLES].filter((table) => serverOnlyConfigurationTables.includes(table)).sort(),
    serverOnlyConfigurationTables,
  );
});

test("schema-derived backup and RLS inventory includes both SQL-managed shop configuration tables", async () => {
  const tables = await loadExpectedPublicTables(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)));
  for (const table of serverOnlyConfigurationTables) assert.ok(tables.includes(table), `${table} must be in the live inventory`);
});

test("standalone RLS verifier derives its inventory instead of freezing a table count", async () => {
  const source = await readFile(new URL("./verify-database-access-hardening.mjs", import.meta.url), "utf8");
  assert.match(source, /loadExpectedPublicTables/);
  assert.match(source, /schema-derived plus SQL-managed/);
  assert.doesNotMatch(source, /const tables = \[/);
});

test("final parity has a guarded DEV command route", () => {
  assert.match(commandPlan("parity", ["--cutover-date", "2026-10-31"])[0], /verify-final-cutover-report-parity\.mjs$/);
});

test("forward migration enables RLS and revokes browser and PUBLIC access to shop configuration", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261029170000_harden_shop_configuration_rls/migration.sql", import.meta.url), "utf8");
  for (const table of serverOnlyConfigurationTables) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM ${role};`));
    }
  }
});

test("cutover reset recognizes all migration-managed evidence tables", () => {
  assert.deepEqual([...MIGRATION_MANAGED_OPERATIONAL_TABLES].sort(), evidenceTables);
});

test("rehearsal/cutover can count migration-managed evidence without Prisma models", async () => {
  const expected = {
    signature_evidence: 2,
    authorization_events: 3,
    authorization_requests: 4,
    document_revisions: 5,
  };
  const values = Object.values(expected);
  let index = 0;
  const database = {
    $queryRawUnsafe: async () => [{ count: values[index++] }],
  };
  assert.deepEqual(await migrationManagedOperationalCounts(database, "00000000-0000-4000-8000-000000000001"), expected);
});

test("cutover reset fails closed when authorization/signature evidence exists", async () => {
  const values = [0, 1, 0, 0];
  let index = 0;
  const database = {
    $queryRawUnsafe: async () => [{ count: values[index++] }],
  };
  await assert.rejects(
    assertNoMigrationManagedOperationalEvidence(database, "00000000-0000-4000-8000-000000000001"),
    /authorization\/signature evidence exists.*authorization_events=1/,
  );
});

test("cutover reset evidence gate passes when evidence tables are empty", async () => {
  const database = {
    $queryRawUnsafe: async () => [{ count: 0 }],
  };
  assert.deepEqual(
    await assertNoMigrationManagedOperationalEvidence(database, "00000000-0000-4000-8000-000000000001"),
    {
      signature_evidence: 0,
      authorization_events: 0,
      authorization_requests: 0,
      document_revisions: 0,
    },
  );
});
