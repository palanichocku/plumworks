import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseIdentityFromUrl } from "./lib/public-db-backup.mjs";
import { readLegacyFinalizedInvoiceHeaders } from "./lib/legacy-finalized-invoice-header.mjs";
import {
  canonicalInvoiceControlHash,
  executeLegacyInvoiceConcernsBackfill,
  parseLegacyInvoiceConcernsBackfillArguments,
  planLegacyInvoiceConcernsBackfill,
} from "./lib/legacy-invoice-concerns-backfill.mjs";

const options = parseLegacyInvoiceConcernsBackfillArguments(process.argv.slice(2));
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
  if (dirname(manifestPath) !== root || manifestPath !== join(root, "manifest.json")) throw new Error("--snapshot-manifest must be the manifest.json directly inside --source-root.");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.formatVersion !== 1 || manifest.snapshotDate !== ACCEPTED_SNAPSHOT_DATE || !/^[0-9a-f]{64}$/.test(manifest.zipSha256) || manifest.fatalIssues?.length) {
    throw new Error("Snapshot manifest is not the accepted Aug. 15 immutable snapshot.");
  }
  const archiveDirectory = dirname(root);
  const expectedName = `shopman32-original-${manifest.zipSha256.slice(0, 12)}.zip`;
  const archive = join(archiveDirectory, expectedName);
  await access(archive);
  if (!(await stat(archive)).isFile() || await hashFile(archive) !== manifest.zipSha256) throw new Error("Immutable snapshot ZIP hash mismatch.");
  const entries = Object.keys(manifest.files ?? {});
  const entry = (name) => {
    const expected = `${manifest.detectedDataDirectory}/${name}`.toLocaleLowerCase("en-US");
    const matches = entries.filter((item) => item.toLocaleLowerCase("en-US") === expected);
    if (matches.length !== 1) throw new Error(`Snapshot manifest must identify exactly one ${name}.`);
    return matches[0];
  };
  const dbfEntry = entry("finalsold.DBF");
  const memoEntry = entry("finalsold.FPT");
  const [dbf, memo] = await Promise.all([unzipEntry(archive, dbfEntry), unzipEntry(archive, memoEntry)]);
  for (const [name, bytes] of [[dbfEntry, dbf], [memoEntry, memo]]) {
    const expected = manifest.files[name];
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== sha256(bytes)) throw new Error(`Snapshot source hash mismatch: ${name}.`);
  }
  return {
    root, manifestPath, manifest, manifestFingerprint: sha256(manifestBytes),
    archive, dbf, memo,
  };
}

const invoiceSelect = {
  id: true, legacyRoNo: true, legacySourceTable: true,
  customerComplaint: true, recommendation: true,
  customerId: true, vehicleId: true, repairOrderId: true,
  invoiceDate: true, closedAt: true, status: true, odometer: true,
  total: true, paidTotal: true, partsTotal: true, laborTotal: true,
  shopSuppliesAmount: true, taxTotal: true,
  customer: { select: { legacyCustno: true } },
  vehicle: { select: { legacyCarno: true } },
};

async function loadLegacyInvoices(client) {
  return client.invoice.findMany({
    where: { shopId: options.shopId, legacySourceTable: { not: null } },
    select: invoiceSelect,
    orderBy: { legacyRoNo: "asc" },
  });
}

const reportRanges = [
  ["January 2026", "2026-01-01", "2026-02-01"],
  ["Q1 2026", "2026-01-01", "2026-04-01"],
  ["H1 2026", "2026-01-01", "2026-07-01"],
  ["2025", "2025-01-01", "2026-01-01"],
  ["Aug 1-15", "2026-08-01", "2026-08-16"],
];

async function reportControls(client) {
  const controls = [];
  for (const [label, start, end] of reportRanges) {
    const aggregate = await client.invoice.aggregate({
      where: {
        shopId: options.shopId,
        OR: [
          { legacySourceTable: null, status: "closed", closedAt: { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${end}T00:00:00Z`) } },
          { legacySourceTable: { not: null }, invoiceDate: { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${end}T00:00:00Z`) } },
        ],
      },
      _count: { _all: true }, _sum: { total: true },
    });
    controls.push({ label, count: aggregate._count._all, total: aggregate._sum.total?.toFixed(2) ?? "0.00" });
  }
  return controls;
}

function printPlan({ snapshot, identity, databaseServer, plan, financialHash, controls }) {
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
  for (const [name, value] of Object.entries(plan.counts)) console.log(`${name}: ${value}`);
  console.log(`missing header ROs: ${plan.classifications.filter((item) => item.code === "header-absent").map((item) => item.legacyRoNo).join(", ") || "none"}`);
  console.log(`financial control SHA-256: ${financialHash}`);
  for (const control of controls) console.log(`report control ${control.label}: ${control.count} / ${control.total}`);
}

async function writeEvidence({ snapshot, identity, plan, financialHash, controls }) {
  if (!options.evidenceOutput) return null;
  const path = resolve(options.evidenceOutput);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const artifact = {
    artifactType: "historical-invoice-concerns-pre-write-evidence",
    createdAt: new Date().toISOString(), databaseFingerprint: identity.fingerprint,
    shopId: options.shopId, snapshotDate: snapshot.manifest.snapshotDate,
    snapshotManifestSha256: snapshot.manifestFingerprint, snapshotZipSha256: snapshot.manifest.zipSha256,
    counts: plan.counts, financialControlSha256: financialHash, reportControls: controls,
    proposals: plan.proposals.map((proposal) => ({
      invoiceId: proposal.id, legacyRoNo: proposal.legacyRoNo,
      oldCustomerComplaint: proposal.beforeCustomerComplaint,
      oldRecommendation: proposal.beforeRecommendation,
      newCustomerComplaint: proposal.customerComplaint,
      newRecommendation: proposal.recommendation,
      newCustomerComplaintSha256: sha256(proposal.customerComplaint ?? ""),
      newRecommendationSha256: sha256(proposal.recommendation ?? ""),
    })),
  };
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
  return { path, sha256: sha256(bytes) };
}

async function main() {
  const snapshot = await validateAcceptedSnapshot(options);
  const headers = readLegacyFinalizedInvoiceHeaders(snapshot.dbf, snapshot.memo);
  const connectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionUrl || !process.env.DATABASE_URL) throw new Error("Database configuration is unavailable.");
  const identity = databaseIdentityFromUrl(connectionUrl);
  if (identity.fingerprint !== options.databaseFingerprint) throw new Error("Database identity fingerprint does not match the explicitly reviewed target.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const [shop, databaseRows, invoices, aliases, controls] = await Promise.all([
      prisma.shop.findUnique({ where: { id: options.shopId }, select: { id: true } }),
      prisma.$queryRawUnsafe("SELECT current_database() AS database_name, inet_server_addr()::text AS server_address"),
      loadLegacyInvoices(prisma),
      prisma.customerLegacyAlias.findMany({ where: { shopId: options.shopId }, select: { aliasLegacyCustno: true, customerId: true } }),
      reportControls(prisma),
    ]);
    if (!shop) throw new Error("The exact Shop ID does not exist in the reviewed database.");
    const databaseServer = { databaseName: databaseRows[0]?.database_name, serverAddress: databaseRows[0]?.server_address };
    if (databaseServer.databaseName !== identity.databaseName) throw new Error("Connected database name differs from the reviewed database identity.");
    const plan = planLegacyInvoiceConcernsBackfill({ invoices, headers, aliases });
    const financialHash = canonicalInvoiceControlHash(invoices);
    printPlan({ snapshot, identity, databaseServer, plan, financialHash, controls });
    const blockers = plan.counts.targetConflicts + plan.counts.sourceConflicts + plan.counts.customerMismatches + plan.counts.vehicleMismatches + plan.counts.soldDateMismatches;
    if (blockers > 0) throw new Error(`Historical text backfill is blocked by ${blockers} conflict or identity mismatch(es).`);
    const evidence = await writeEvidence({ snapshot, identity, plan, financialHash, controls });
    if (evidence) {
      console.log(`pre-write evidence artifact: ${evidence.path}`);
      console.log(`pre-write evidence SHA-256: ${evidence.sha256}`);
    }
    if (options.dryRun) {
      console.log("database writes performed: 0");
      console.log("classification: READY FOR HISTORICAL TEXT BACKFILL");
      return;
    }
    const result = await prisma.$transaction(async (transaction) => {
      const currentInvoices = await loadLegacyInvoices(transaction);
      const currentPlan = planLegacyInvoiceConcernsBackfill({ invoices: currentInvoices, headers, aliases });
      if (JSON.stringify(currentPlan.proposals) !== JSON.stringify(plan.proposals) || canonicalInvoiceControlHash(currentInvoices) !== financialHash) {
        throw new Error("Concurrent Invoice change detected before the write; backfill was rolled back.");
      }
      const write = await executeLegacyInvoiceConcernsBackfill({ transaction, shopId: options.shopId, proposals: currentPlan.proposals });
      const afterInvoices = await loadLegacyInvoices(transaction);
      if (canonicalInvoiceControlHash(afterInvoices) !== financialHash) throw new Error("Non-text Invoice controls changed; backfill was rolled back.");
      const afterPlan = planLegacyInvoiceConcernsBackfill({ invoices: afterInvoices, headers, aliases });
      if (afterPlan.proposals.length !== 0 || afterPlan.counts.targetConflicts !== 0) throw new Error("Backfill post-write verification failed; transaction was rolled back.");
      return { ...write, alreadyCurrentAfter: afterPlan.counts.alreadyCurrent };
    }, { maxWait: 10_000, timeout: 120_000 });
    const afterControls = await reportControls(prisma);
    if (JSON.stringify(afterControls) !== JSON.stringify(controls)) throw new Error("Report controls changed unexpectedly after commit.");
    console.log(`database writes performed: ${result.updated}`);
    console.log(`already current after write: ${result.alreadyCurrentAfter}`);
    console.log("classification: COMPLETED HISTORICAL TEXT BACKFILL");
  } finally {
    await prisma.$disconnect();
  }
}

await main();
