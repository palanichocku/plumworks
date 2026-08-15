#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  PUBLIC_BACKUP_FORMAT_VERSION, PUBLIC_BACKUP_TYPE, databaseIdentityFromUrl,
  issueVerifiedBackupGate, loadExpectedPublicTables, sha256, validateArchiveEvidence,
  validateBackupManifest, validatePostRestoreControls,
} from "../lib/public-db-backup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const schemaPath = resolve(root, "prisma/schema.prisma");

function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
function requireArg(name) { const value = arg(name); if (!value) throw new Error(`${name} is required.`); return value; }
function command(commandName, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(commandName, args, { env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = ""; let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; }); child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`${commandName} failed (${code}): ${stderr.trim()}`)));
  });
}
async function mode(path) { return (await stat(path)).mode & 0o777; }
async function safePermissions(path, expected) { const actual = await mode(path); if (actual !== expected) throw new Error(`Unsafe permissions on ${path}: ${actual.toString(8)}; expected ${expected.toString(8)}.`); }
async function fileSha(path) { return sha256(await readFile(path)); }

async function databaseControls(databaseUrl, shopId, expectedTables) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [server, shop, tables, sequences, rls, migrations, financial, extensions] = await Promise.all([
      client.query("SELECT current_database() AS database_name, current_setting('server_version') AS server_version"),
      shopId
        ? client.query("SELECT id::text, name, next_repair_order_number::text FROM public.shops WHERE id = $1::uuid", [shopId])
        : client.query("SELECT id::text, name, next_repair_order_number::text FROM public.shops ORDER BY id"),
      client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),
      client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename"),
      client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity ORDER BY c.relname"),
      client.query('SELECT migration_name, checksum, finished_at, applied_steps_count FROM public."_prisma_migrations" ORDER BY migration_name'),
      client.query("SELECT (SELECT COALESCE(SUM(total),0)::text FROM public.invoices WHERE shop_id=$1::uuid) AS invoice_total, (SELECT COALESCE(SUM(paid_total),0)::text FROM public.invoices WHERE shop_id=$1::uuid) AS paid_total, (SELECT COALESCE(SUM(balance),0)::text FROM public.accounts_receivable WHERE shop_id=$1::uuid) AS ar_balance", [shopId ?? "00000000-0000-0000-0000-000000000000"]),
      client.query("SELECT extname, extversion FROM pg_extension ORDER BY extname"),
    ]);
    if (shop.rowCount !== 1) throw new Error("The requested Shop was not found exactly once in the backup database.");
    const actualTables = tables.rows.map((row) => row.tablename);
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) throw new Error(`Live public table inventory differs from Prisma inventory. actual=${actualTables.join(",")}`);
    const resolvedShopId = shop.rows[0].id;
    const financialResult = shopId ? financial.rows[0] : (await client.query("SELECT (SELECT COALESCE(SUM(total),0)::text FROM public.invoices WHERE shop_id=$1::uuid) AS invoice_total, (SELECT COALESCE(SUM(paid_total),0)::text FROM public.invoices WHERE shop_id=$1::uuid) AS paid_total, (SELECT COALESCE(SUM(balance),0)::text FROM public.accounts_receivable WHERE shop_id=$1::uuid) AS ar_balance", [resolvedShopId])).rows[0];
    const rowCounts = {};
    for (const table of expectedTables) rowCounts[table] = String((await client.query(`SELECT COUNT(*)::text AS count FROM public."${table}"`)).rows[0].count);
    const migrationControl = sha256(JSON.stringify(migrations.rows));
    return {
      serverVersion: server.rows[0].server_version, databaseName: server.rows[0].database_name,
      shop: { id: shop.rows[0].id, name: shop.rows[0].name, nextRepairOrderNumber: shop.rows[0].next_repair_order_number },
      publicTables: actualTables, publicSequences: sequences.rows.map((row) => row.sequencename),
      rlsTables: rls.rows.map((row) => row.relname), rowCounts,
      prismaMigrations: { count: migrations.rowCount, controlSha256: migrationControl },
      financialControls: financialResult,
      extensions: extensions.rows,
    };
  } finally { await client.end(); }
}

async function postRestore() {
  const directory = resolve(requireArg("--directory")); const shopId = requireArg("--shop-id"); const databaseUrl = process.env.DIRECT_URL;
  if (!databaseUrl) throw new Error("DIRECT_URL is required.");
  const verified = await verifyDirectory({ directory, databaseUrl, shopId });
  const expectedTables = await loadExpectedPublicTables(schemaPath);
  const controls = await databaseControls(databaseUrl, shopId, expectedTables);
  const manifest = verified.manifest;
  const client = new Client({ connectionString: databaseUrl }); await client.connect();
  try {
    const [policies, grants, membershipOrphans, direct] = await Promise.all([
      client.query("SELECT COUNT(*)::int AS count FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])", [expectedTables]),
      client.query("SELECT table_name, grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=ANY($1::text[]) AND (grantee IN ('anon','authenticated') OR (grantee='service_role' AND table_name='_prisma_migrations'))", [expectedTables]),
      client.query("SELECT COUNT(*)::int AS count FROM public.shop_memberships m LEFT JOIN auth.users u ON u.id=m.user_id WHERE u.id IS NULL"),
      client.query("SELECT 1 AS works"),
    ]);
    validatePostRestoreControls({ manifest, controls, expectedTables, policyCount: policies.rows[0].count, forbiddenGrantCount: grants.rowCount, membershipOrphanCount: membershipOrphans.rows[0].count });
    if (direct.rows[0].works !== 1) throw new Error("Direct database verification failed.");
  } finally { await client.end(); }
  process.stdout.write(`${JSON.stringify({ status: "passed", publicTables: expectedTables.length, shopId })}\n`);
}

async function gitDetails() {
  const commit = (await command("git", ["-C", root, "rev-parse", "HEAD"], { capture: true })).trim();
  const dirty = Boolean((await command("git", ["-C", root, "status", "--short"], { capture: true })).trim());
  return { commit, state: dirty ? "dirty" : "clean" };
}

export async function verifyDirectory({ directory, databaseUrl, shopId }) {
  const expectedTables = await loadExpectedPublicTables(schemaPath);
  const entries = (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
  const dumps = (await entries).filter((entry) => entry.isFile() && entry.name.endsWith(".dump"));
  if (dumps.length !== 1) throw new Error(`Expected exactly one authoritative .dump; found ${dumps.length}.`);
  const dumpPath = resolve(directory, dumps[0].name); const manifestPath = resolve(directory, "manifest.json");
  const checksumPath = resolve(directory, "sha256.txt"); const archiveListPath = resolve(directory, "archive-contents.txt");
  await safePermissions(directory, 0o700);
  for (const path of [dumpPath, manifestPath, checksumPath, archiveListPath]) await safePermissions(path, 0o600);
  const info = await stat(dumpPath); if (!info.isFile() || info.size <= 0) throw new Error("Backup archive is empty.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const resolvedShopId = shopId ?? manifest.shop?.id;
  if (!resolvedShopId) throw new Error("Expected Shop identity is required.");
  const identity = databaseIdentityFromUrl(databaseUrl);
  const actualSha = await fileSha(dumpPath);
  validateBackupManifest({ manifest, dumpFilename: basename(dumpPath), dumpBytes: info.size, dumpSha256: actualSha, expectedIdentity: identity, expectedShopId: resolvedShopId, expectedTables });
  const checksum = (await readFile(checksumPath, "utf8")).trim().split(/\s+/);
  if (checksum[0] !== actualSha || checksum[1] !== basename(dumpPath)) throw new Error("Checksum file is not associated with the authoritative archive.");
  const archiveText = await command("pg_restore", ["--list", dumpPath], { capture: true });
  validateArchiveEvidence({ archiveText, expectedTables, expectedRlsTables: manifest.rlsTables, expectedSequences: manifest.publicSequences });
  return { directory, dumpPath, manifestPath, manifest, gate: issueVerifiedBackupGate({ databaseFingerprint: identity.fingerprint, shopId: resolvedShopId, manifestSha256: sha256(await readFile(manifestPath)), dumpSha256: manifest.sha256 }) };
}

async function create() {
  const directory = resolve(requireArg("--directory")); const shopId = arg("--shop-id"); const databaseUrl = process.env.DIRECT_URL;
  if (!databaseUrl) throw new Error("DIRECT_URL is required.");
  await mkdir(directory, { recursive: false, mode: 0o700 }); await safePermissions(directory, 0o700);
  const expectedTables = await loadExpectedPublicTables(schemaPath); const controls = await databaseControls(databaseUrl, shopId, expectedTables);
  const identity = databaseIdentityFromUrl(databaseUrl); if (controls.databaseName !== identity.databaseName) throw new Error("DIRECT_URL database name differs from server identity.");
  const missingRls = expectedTables.filter((table) => !controls.rlsTables.includes(table));
  if (missingRls.length) throw new Error(`Live public application tables are missing RLS: ${missingRls.join(", ")}.`);
  await command(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "status", "--schema", schemaPath], {
    capture: true, env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  });
  const finalName = "plumworks-public-cutover.dump"; const incomplete = resolve(directory, `${finalName}.incomplete`); const finalPath = resolve(directory, finalName);
  await command("pg_dump", ["--dbname", databaseUrl, "--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--file", incomplete]);
  await chmod(incomplete, 0o600); const info = await stat(incomplete); if (info.size <= 0) throw new Error("pg_dump produced an empty archive.");
  const archiveText = await command("pg_restore", ["--list", incomplete], { capture: true });
  validateArchiveEvidence({ archiveText, expectedTables, expectedRlsTables: expectedTables, expectedSequences: controls.publicSequences });
  await rename(incomplete, finalPath); await chmod(finalPath, 0o600);
  const git = await gitDetails(); const clientVersion = (await command("pg_dump", ["--version"], { capture: true })).trim();
  const manifest = {
    formatVersion: PUBLIC_BACKUP_FORMAT_VERSION, backupType: PUBLIC_BACKUP_TYPE, createdAtUtc: new Date().toISOString(), backupFilename: finalName,
    sha256: await fileSha(finalPath), byteSize: (await stat(finalPath)).size, postgresClientVersion: clientVersion, postgresServerVersion: controls.serverVersion,
    database: identity, shop: controls.shop, repository: git, prismaMigrationStatus: "up-to-date",
    publicTables: controls.publicTables, publicSequences: controls.publicSequences, rlsTables: controls.rlsTables, rowCounts: controls.rowCounts,
    prismaMigrations: controls.prismaMigrations, financialControls: controls.financialControls, extensions: controls.extensions,
    tool: { name: "scripts/db/public-db-backup.mjs", version: 1 }, verification: { status: "passed", archiveListValidated: true },
    boundaries: { schemas: ["public"], authIncluded: false, storageIncluded: false, ownersIncluded: false, privilegesIncluded: false },
  };
  const manifestPath = resolve(directory, "manifest.json"); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await chmod(manifestPath, 0o600);
  await writeFile(resolve(directory, "sha256.txt"), `${manifest.sha256}  ${finalName}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(resolve(directory, "archive-contents.txt"), archiveText, { flag: "wx", mode: 0o600 });
  const verified = await verifyDirectory({ directory, databaseUrl, shopId });
  process.stdout.write(`${JSON.stringify({ directory, manifestPath: verified.manifestPath, dumpPath: verified.dumpPath })}\n`);
}

async function verify() {
  const directory = resolve(requireArg("--directory")); const shopId = arg("--shop-id"); const databaseUrl = process.env.DIRECT_URL;
  if (!databaseUrl) throw new Error("DIRECT_URL is required.");
  const result = await verifyDirectory({ directory, databaseUrl, shopId });
  const client = new Client({ connectionString: databaseUrl }); await client.connect();
  try {
    const [server, extensions, shop] = await Promise.all([
      client.query("SELECT current_setting('server_version') AS server_version"),
      client.query("SELECT extname, extversion FROM pg_extension ORDER BY extname"),
      client.query("SELECT id::text, name FROM public.shops WHERE id=$1::uuid", [result.manifest.shop.id]),
    ]);
    const sourceMajor = String(result.manifest.postgresServerVersion).split(".")[0];
    const targetMajor = String(server.rows[0].server_version).split(".")[0];
    if (sourceMajor !== targetMajor) throw new Error(`PostgreSQL major-version mismatch: backup=${sourceMajor}, target=${targetMajor}.`);
    if (JSON.stringify(extensions.rows) !== JSON.stringify(result.manifest.extensions ?? [])) throw new Error("Target extension inventory differs from the backup manifest.");
    if (shop.rowCount !== 1 || shop.rows[0].name !== result.manifest.shop.name) throw new Error("Restore target does not contain the manifest-bound Shop identity.");
  } finally { await client.end(); }
  process.stdout.write(`${JSON.stringify({ directory, manifestPath: result.manifestPath, dumpPath: result.dumpPath })}\n`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const action = process.argv[2];
  if (action === "create") await create();
  else if (action === "verify") await verify();
  else if (action === "post-restore") await postRestore();
  else throw new Error("Usage: public-db-backup.mjs create|verify|post-restore --directory PATH --shop-id UUID");
}
