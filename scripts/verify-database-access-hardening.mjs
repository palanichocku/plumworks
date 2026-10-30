import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadExpectedPublicTables } from "./lib/public-db-backup.mjs";

const expectedTables = await loadExpectedPublicTables(resolve("prisma/schema.prisma"));
const tables = expectedTables.filter((table) => table !== "_prisma_migrations");
const baselinePath = "/tmp/plumworks-rls-row-counts.json";
const migrationPath = "prisma/migrations/20260715143000_harden_public_table_access/migration.sql";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function rowCounts() {
  const entries = await Promise.all(tables.map(async (table) => {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "public"."${table}"`);
    return [table, rows[0].count];
  }));
  return Object.fromEntries(entries);
}

try {
  const counts = await rowCounts();
  if (process.argv.includes("--snapshot")) {
    await writeFile(baselinePath, JSON.stringify(counts), { mode: 0o600 });
    console.log(`baseline table counts captured: ${tables.length}`);
    process.exitCode = 0;
  } else {
    const [catalog, grants, runtimeRole, migrationSql] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`, tables),
      prisma.$queryRawUnsafe(`SELECT table_name, grantee FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND grantee IN ('anon', 'authenticated')`, tables),
      prisma.$queryRawUnsafe(`SELECT r.rolbypassrls AS bypass_rls, bool_and(c.relowner = r.oid) AS owns_tables FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE r.rolname = current_user AND n.nspname = 'public' AND c.relname = ANY($1::text[]) GROUP BY r.rolbypassrls`, tables),
      readFile(migrationPath, "utf8"),
    ]);
    const rlsTables = new Set(catalog.filter((row) => row.rls_enabled).map((row) => row.table_name));
    const grantedTables = new Set(grants.map((row) => row.table_name));
    const protectedTables = tables.filter((table) => rlsTables.has(table) && !grantedTables.has(table));
    const missingTables = tables.filter((table) => !catalog.some((row) => row.table_name === table));
    const prismaRoleWorks = runtimeRole.length === 1 && (runtimeRole[0].bypass_rls || runtimeRole[0].owns_tables);
    const shopQueryWorks = Boolean(await prisma.shop.findFirst({ select: { id: true } }).then(() => true));
    const authSchemaUntouched = !/(?:"auth"|\bauth)\s*\./i.test(migrationSql);
    let countsUnchanged = 0;
    try {
      const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
      countsUnchanged = Number(tables.every((table) => baseline[table] === counts[table]));
    } catch {
      countsUnchanged = 0;
    }

    console.log(`application tables reviewed: ${tables.length} (schema-derived plus SQL-managed)`);
    console.log(`tables with RLS and API privileges revoked: ${protectedTables.length}/${tables.length}`);
    console.log(`expected tables present: ${tables.length - missingTables.length}/${tables.length}`);
    console.log(`Prisma runtime role remains eligible: ${Number(prismaRoleWorks)}`);
    console.log(`Prisma server query works: ${Number(shopQueryWorks)}`);
    console.log(`Supabase Auth schema untouched: ${Number(authSchemaUntouched)}`);
    console.log(`data row counts unchanged: ${countsUnchanged}`);
    if (missingTables.length || protectedTables.length !== tables.length) process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
