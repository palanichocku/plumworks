import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  expectedPublicTablesFromPrisma,
  loadExpectedPublicTables,
  MIGRATION_MANAGED_PUBLIC_TABLES,
} from "./lib/public-db-backup.mjs";
import {
  deleteOperationalData,
  migrationManagedOperationalCounts,
  MIGRATION_MANAGED_OPERATIONAL_TABLES,
} from "./lib/legacy-cutover-reset.mjs";

const evidenceTables = [
  "authorization_events",
  "authorization_requests",
  "document_revisions",
  "signature_evidence",
];

test("backup inventory adds migration-managed authorization evidence after Prisma parsing", async () => {
  assert.deepEqual([...MIGRATION_MANAGED_PUBLIC_TABLES].sort(), evidenceTables);
  const schema = 'model Shop {\n id String @id\n @@map("shops")\n}';
  assert.deepEqual(expectedPublicTablesFromPrisma(schema), ["_prisma_migrations", "shops"]);
  const directory = await mkdtemp(join(tmpdir(), "cutover-auth-evidence-"));
  const schemaPath = join(directory, "schema.prisma");
  await writeFile(schemaPath, schema);
  assert.deepEqual(
    await loadExpectedPublicTables(schemaPath),
    ["_prisma_migrations", ...evidenceTables, "shops"].sort(),
  );
});

test("cutover reset declares authorization evidence in FK-safe deletion order", () => {
  assert.deepEqual(MIGRATION_MANAGED_OPERATIONAL_TABLES, [
    "signature_evidence",
    "authorization_events",
    "authorization_requests",
    "document_revisions",
  ]);
});

test("cutover reset deletes migration-managed evidence before Prisma operational rows", async () => {
  const operations = [];
  const transaction = {
    $executeRawUnsafe: async (sql, shopId) => {
      operations.push({ type: "sql", sql, shopId });
      return 1;
    },
    auditLog: {
      deleteMany: async () => { operations.push({ type: "audit" }); },
    },
  };
  const models = [
    "payment", "accountReceivable", "invoicePart", "invoiceLabor", "invoice",
    "repairOrderPart", "repairOrderLabor", "repairOrder", "vehicle",
    "customerLegacyAlias", "customer", "legacyImportError", "rawLegacyCustomer",
    "rawLegacyVehicle", "rawLegacyFinal", "rawLegacyLaborFinal", "rawLegacyAr",
    "rawLegacyOrderPart", "rawLegacyOrderLabor", "legacyImportRun",
  ];
  for (const model of models) {
    transaction[model] = { deleteMany: async () => { operations.push({ type: "model", model }); } };
  }

  await deleteOperationalData(transaction, "00000000-0000-4000-8000-000000000001");

  assert.deepEqual(
    operations.slice(0, 4).map(({ sql }) => sql.match(/public\.([a-z_]+)/)?.[1]),
    ["signature_evidence", "authorization_events", "authorization_requests", "document_revisions"],
  );
  assert.equal(operations[4].type, "audit");
  assert.equal(operations.at(-1).model, "legacyImportRun");
});

test("cutover preflight can count migration-managed evidence without Prisma models", async () => {
  const counts = [2, 3, 4, 5];
  let index = 0;
  const database = {
    $queryRawUnsafe: async () => [{ count: counts[index++] }],
  };
  assert.deepEqual(await migrationManagedOperationalCounts(database, "00000000-0000-4000-8000-000000000001"), {
    signature_evidence: 2,
    authorization_events: 3,
    authorization_requests: 4,
    document_revisions: 5,
  });
});
