import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseIdentityFromUrl } from "./lib/public-db-backup.mjs";
import {
  canonicalCustomerNonNotesHash,
  executeLegacyCustomerNotesBackfill,
  parseLegacyCustomerNotesBackfillArguments,
  planLegacyCustomerNotesBackfill,
  readLegacyCustomerNoteSources,
} from "./lib/legacy-customer-notes-backfill.mjs";

const options = parseLegacyCustomerNotesBackfillArguments(process.argv.slice(2));
const ACCEPTED_SNAPSHOT_DATE = "2026-08-15";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function unzipEntry(archive, entry) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn("unzip", ["-p", archive, entry], { stdio: ["ignore", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolvePromise(Buffer.concat(output))
      : reject(new Error(`Unable to read immutable snapshot archive entry: ${Buffer.concat(errors).toString("utf8").trim()}`)));
  });
}

async function validateAcceptedSnapshot({ sourceRoot, snapshotManifest }) {
  const root = await realpath(resolve(sourceRoot));
  const manifestPath = await realpath(resolve(snapshotManifest));
  if (dirname(manifestPath) !== root || manifestPath !== join(root, "manifest.json")) throw new Error("--snapshot-manifest must be manifest.json directly inside --source-root.");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.formatVersion !== 1 || manifest.snapshotDate !== ACCEPTED_SNAPSHOT_DATE || !/^[0-9a-f]{64}$/.test(manifest.zipSha256) || manifest.fatalIssues?.length) {
    throw new Error("Snapshot manifest is not the accepted Aug. 15 immutable snapshot.");
  }
  const archive = join(dirname(root), `shopman32-original-${manifest.zipSha256.slice(0, 12)}.zip`);
  await access(archive);
  if (!(await stat(archive)).isFile() || await hashFile(archive) !== manifest.zipSha256) throw new Error("Immutable snapshot ZIP hash mismatch.");
  const entries = Object.keys(manifest.files ?? {});
  const entry = (name) => {
    const expected = `${manifest.detectedDataDirectory}/${name}`.toLocaleLowerCase("en-US");
    const matches = entries.filter((item) => item.toLocaleLowerCase("en-US") === expected);
    if (matches.length !== 1) throw new Error(`Snapshot manifest must identify exactly one ${name}.`);
    return matches[0];
  };
  const dbfEntry = entry("Cust.DBF");
  const memoEntry = entry("Cust.FPT");
  const [dbf, memo] = await Promise.all([unzipEntry(archive, dbfEntry), unzipEntry(archive, memoEntry)]);
  for (const [name, bytes] of [[dbfEntry, dbf], [memoEntry, memo]]) {
    const expected = manifest.files[name];
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== sha256(bytes)) throw new Error(`Snapshot source hash mismatch: ${name}.`);
  }
  return { root, manifest, manifestFingerprint: sha256(manifestBytes), dbfEntry, memoEntry, dbf, memo };
}

const customerSelect = {
  id: true, shopId: true, displayName: true, email: true, phone: true, phone2: true,
  addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true,
  notes: true, message: true, legacyCustno: true, legacySourceTable: true,
  archivedAt: true, createdAt: true, updatedAt: true,
};

async function loadCanonicalCustomers(client) {
  return client.customer.findMany({
    where: { shopId: options.shopId, legacySourceTable: "Cust.DBF", legacyCustno: { not: null } },
    select: customerSelect,
    orderBy: { legacyCustno: "asc" },
  });
}

function printPlan({ snapshot, identity, databaseServer, plan, nonNotesHash }) {
  console.log(`execution mode: ${options.dryRun ? "DRY RUN" : "CONFIRMED WRITE"}`);
  console.log(`database target: ${identity.redactedTarget}`);
  console.log(`database fingerprint: ${identity.fingerprint}`);
  console.log(`database server address: ${databaseServer.serverAddress ?? "unavailable"}`);
  console.log(`database name: ${databaseServer.databaseName}`);
  console.log(`shop id: ${options.shopId}`);
  console.log(`snapshot root: ${snapshot.root}`);
  console.log(`snapshot date: ${snapshot.manifest.snapshotDate}`);
  console.log(`snapshot manifest SHA-256: ${snapshot.manifestFingerprint}`);
  console.log(`snapshot ZIP SHA-256: ${snapshot.manifest.zipSha256}`);
  console.log(`Cust.DBF entry: ${snapshot.dbfEntry}`);
  console.log(`Cust.FPT entry: ${snapshot.memoEntry}`);
  for (const [name, value] of Object.entries(plan.counts)) console.log(`${name}: ${value}`);
  const multiline = plan.proposals.find((proposal) => /[\r\n]/.test(proposal.notes));
  if (multiline) console.log(`representative multiline source: ${multiline.notes.split(/\r\n|\r|\n/).length} lines, SHA-256 ${sha256(multiline.notes)}`);
  console.log(`non-notes Customer control SHA-256: ${nonNotesHash}`);
}

async function writeEvidence({ snapshot, identity, plan, nonNotesHash }) {
  const path = resolve(options.evidenceOutput);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const artifact = {
    artifactType: "legacy-customer-notes-pre-write-evidence",
    createdAt: new Date().toISOString(), databaseFingerprint: identity.fingerprint,
    shopId: options.shopId, snapshotDate: snapshot.manifest.snapshotDate,
    snapshotManifestSha256: snapshot.manifestFingerprint, snapshotZipSha256: snapshot.manifest.zipSha256,
    counts: plan.counts, nonNotesCustomerControlSha256: nonNotesHash,
    proposals: plan.proposals.map((proposal) => ({
      customerId: proposal.id, legacyCustno: proposal.legacyCustno,
      oldNotesState: proposal.beforeNotes === null ? "null" : "non-null",
      sourceNotesSha256: sha256(proposal.notes),
    })),
  };
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  return { path, sha256: sha256(bytes) };
}

async function main() {
  const snapshot = await validateAcceptedSnapshot(options);
  const sources = readLegacyCustomerNoteSources(snapshot.dbf, snapshot.memo);
  const connectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionUrl || !process.env.DATABASE_URL) throw new Error("Database configuration is unavailable.");
  const identity = databaseIdentityFromUrl(connectionUrl);
  if (identity.fingerprint !== options.databaseFingerprint) throw new Error("Database identity fingerprint does not match the explicitly reviewed target.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const [shop, databaseRows, customers, aliases] = await Promise.all([
      prisma.shop.findUnique({ where: { id: options.shopId }, select: { id: true } }),
      prisma.$queryRawUnsafe("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address"),
      loadCanonicalCustomers(prisma),
      prisma.customerLegacyAlias.findMany({ where: { shopId: options.shopId }, select: { aliasLegacyCustno: true, customerId: true } }),
    ]);
    if (!shop) throw new Error("The exact Shop ID does not exist in the reviewed database.");
    const databaseServer = { databaseName: databaseRows[0]?.database_name, serverAddress: databaseRows[0]?.server_address };
    if (databaseServer.databaseName !== identity.databaseName) throw new Error("Connected database name differs from the reviewed database identity.");
    const plan = planLegacyCustomerNotesBackfill({ sources, customers, aliases });
    const nonNotesHash = canonicalCustomerNonNotesHash(customers);
    printPlan({ snapshot, identity, databaseServer, plan, nonNotesHash });
    if (plan.counts.targetConflicts || plan.counts.sourceAmbiguities) throw new Error("Customer notes backfill is blocked by target conflicts or ambiguous source records.");
    if (options.dryRun) {
      console.log("database writes performed: 0");
      console.log("classification: READY FOR CUSTOMER NOTES BACKFILL");
      return;
    }
    const evidence = await writeEvidence({ snapshot, identity, plan, nonNotesHash });
    console.log(`pre-write evidence artifact: ${evidence.path}`);
    console.log(`pre-write evidence SHA-256: ${evidence.sha256}`);
    const result = await prisma.$transaction(async (transaction) => {
      const currentCustomers = await loadCanonicalCustomers(transaction);
      const currentPlan = planLegacyCustomerNotesBackfill({ sources, customers: currentCustomers, aliases });
      if (JSON.stringify(currentPlan.proposals) !== JSON.stringify(plan.proposals) || canonicalCustomerNonNotesHash(currentCustomers) !== nonNotesHash) {
        throw new Error("Concurrent Customer change detected before the write; backfill was rolled back.");
      }
      const write = await executeLegacyCustomerNotesBackfill({ transaction, shopId: options.shopId, proposals: currentPlan.proposals });
      const afterCustomers = await loadCanonicalCustomers(transaction);
      if (canonicalCustomerNonNotesHash(afterCustomers) !== nonNotesHash) throw new Error("A non-notes Customer field changed; backfill was rolled back.");
      const afterPlan = planLegacyCustomerNotesBackfill({ sources, customers: afterCustomers, aliases });
      if (afterPlan.proposals.length || afterPlan.counts.targetConflicts || afterPlan.counts.sourceAmbiguities) throw new Error("Customer notes post-write verification failed; backfill was rolled back.");
      return { ...write, alreadyCurrentAfter: afterPlan.counts.alreadyCurrent };
    }, { maxWait: 10_000, timeout: 120_000 });
    console.log(`database writes performed: ${result.updated}`);
    console.log(`already current after write: ${result.alreadyCurrentAfter}`);
    console.log("classification: COMPLETED CUSTOMER NOTES BACKFILL");
  } finally {
    await prisma.$disconnect();
  }
}

await main();
