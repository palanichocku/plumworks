import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoMigrationManagedOperationalEvidence,
  migrationManagedOperationalCounts,
  MIGRATION_MANAGED_OPERATIONAL_TABLES,
} from "./lib/legacy-cutover-reset.mjs";
import {
  MIGRATION_MANAGED_PUBLIC_TABLES,
  expectedPublicTablesFromPrisma,
} from "./lib/public-db-backup.mjs";

const evidenceTables = [
  "authorization_events",
  "authorization_requests",
  "document_revisions",
  "signature_evidence",
];

test("backup inventory declares all migration-managed authorization evidence tables", () => {
  assert.deepEqual([...MIGRATION_MANAGED_PUBLIC_TABLES].sort(), evidenceTables);
  assert.deepEqual(
    expectedPublicTablesFromPrisma('model Shop {\n id String @id\n @@map("shops")\n}'),
    ["_prisma_migrations", "shops"],
  );
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
