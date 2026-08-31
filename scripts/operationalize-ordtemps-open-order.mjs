import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { databaseIdentityFromUrl } from "./lib/public-db-backup.mjs";
import { resolveLegacySource } from "./lib/legacy-source.mjs";
import { validateSnapshotManifestForRecovery } from "./lib/legacy-recovery-upgrade.mjs";
import { artifactSha256, loadOrdtempsResolutionEvidence, ORDTEMPS_RESOLUTION_FILES, ORDTEMPS_RESOLUTION_TYPE, ORDTEMPS_RESOLUTION_VERSION, validateOrdtempsResolution } from "./lib/legacy-ordtemps-open-order-resolution.mjs";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const SHOP_NAME = "CAR DOC LLC";
const DATABASE_FINGERPRINT = "48801c9aa0656b9d2a7ed395c333cb087c921f04bfc451d991ea17d0cd350a8b";
const CONFIRMATION = "OPERATIONALIZE_APPROVED_RO_21775";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function option(name, required = true) {
  const positions = process.argv.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length > 1 || (required && positions.length !== 1)) throw new Error(`${name} must be supplied exactly once.`);
  return positions.length ? process.argv[positions[0] + 1] : null;
}

async function context(snapshotManifestPath) {
  const snapshot = await validateSnapshotManifestForRecovery({ manifestPath: snapshotManifestPath });
  const source = await resolveLegacySource({ args: ["--source", snapshot.source.path], requiredFiles: ORDTEMPS_RESOLUTION_FILES });
  for (const file of ORDTEMPS_RESOLUTION_FILES) {
    const relative = `${snapshot.manifest.detectedDataDirectory}/${source.actualFiles[file]}`;
    if (snapshot.manifest.files?.[relative]?.sha256 !== source.fingerprints[file]) throw new Error(`Immutable snapshot hash mismatch: ${file}.`);
  }
  const manifestBytes = await readFile(resolve(snapshotManifestPath));
  const evidence = await loadOrdtempsResolutionEvidence(source, 21775);
  return { snapshot, source, evidence, snapshotManifestSha256: sha256(manifestBytes) };
}

async function createApproval(snapshotManifestPath, output) {
  const loaded = await context(snapshotManifestPath);
  const artifact = {
    formatVersion: ORDTEMPS_RESOLUTION_VERSION, artifactType: ORDTEMPS_RESOLUTION_TYPE, shopId: SHOP_ID,
    snapshot: { snapshotDate: loaded.snapshot.manifest.snapshotDate, zipSha256: loaded.snapshot.manifest.zipSha256, snapshotManifestSha256: loaded.snapshotManifestSha256, combinedSourceFingerprint: loaded.source.fingerprint, sourceHashes: loaded.source.fingerprints },
    decisions: [{ action: "operationalize-reviewed-ordtemps-open-repair-order", resolved: { roNumber: 21775, customerLegacyId: "87612072", vehicleLegacyId: "87612073", roDate: "2026-08-29", mileage: 91705, status: "open", partsCount: 0, laborCount: 0 }, evidence: loaded.evidence, reason: "Human-approved genuine zero-line open Repair Order from the active ordtemps header, corroborating deleted structural rows, exact Customer/Vehicle identity, and no finalized or sold-history collision." }],
    approval: { approved: true, reviewedBy: "Customer-authorized human reviewer", reviewedAt: new Date().toISOString(), reason: "I approve operationalizing RO 21775 from the August 29, 2026 immutable Windows snapshot for Customer 87612072 (NAIMY), Vehicle 87612073 (2005 Acura RSX), dated August 29, 2026, at 91,705 miles. The order is approved as an open Repair Order with no substantive labor or parts lines." },
  };
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await writeFile(resolve(output), bytes, { flag: "wx", mode: 0o600 });
  await chmod(resolve(output), 0o600);
  console.log(JSON.stringify({ artifact: resolve(output), sha256: artifactSha256(bytes) }, null, 2));
}

async function financialControls(prisma) {
  const [invoices, payments, ar, totals] = await Promise.all([
    prisma.invoice.count({ where: { shopId: SHOP_ID } }), prisma.payment.count({ where: { shopId: SHOP_ID } }), prisma.accountReceivable.count({ where: { shopId: SHOP_ID } }),
    prisma.$queryRawUnsafe(`SELECT
      COALESCE(SUM(total) FILTER (WHERE invoice_date >= DATE '2026-01-01' AND invoice_date < DATE '2026-02-01'),0)::text AS january_2026,
      COALESCE(SUM(total) FILTER (WHERE invoice_date >= DATE '2026-01-01' AND invoice_date < DATE '2026-07-01'),0)::text AS h1_2026,
      COALESCE(SUM(total) FILTER (WHERE invoice_date >= DATE '2025-01-01' AND invoice_date < DATE '2026-01-01'),0)::text AS year_2025
      FROM invoices WHERE shop_id = '${SHOP_ID}'::uuid`),
  ]);
  return { invoices, payments, ar, january2026: totals[0].january_2026, h1_2026: totals[0].h1_2026, year2025: totals[0].year_2025 };
}

async function operationalize(snapshotManifestPath, artifactPath, confirmed) {
  const loaded = await context(snapshotManifestPath);
  const bytes = await readFile(resolve(artifactPath));
  const artifact = JSON.parse(bytes.toString("utf8"));
  const validation = validateOrdtempsResolution({ artifact, artifactSha256: artifactSha256(bytes), snapshotManifest: loaded.snapshot.manifest, snapshotManifestSha256: loaded.snapshotManifestSha256, source: loaded.source, evidence: loaded.evidence });
  if (validation.issues.length) throw new Error(`Approval rejected: ${validation.issues[0].code}.`);
  const connectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionUrl || !process.env.DATABASE_URL) throw new Error("Database configuration is unavailable.");
  const identity = databaseIdentityFromUrl(connectionUrl);
  if (identity.fingerprint !== DATABASE_FINGERPRINT) throw new Error("Production database fingerprint mismatch.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const migrationDirectories = (await readdir(resolve("prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const [shop, applied, customer, vehicle, existing, openCount, ro21773, before] = await Promise.all([
      prisma.shop.findUnique({ where: { id: SHOP_ID }, select: { id: true, name: true, nextRepairOrderNumber: true, defaultTaxRate: true, partsTaxable: true, laborTaxable: true, shopSuppliesEnabled: true, shopSuppliesRate: true, shopSuppliesCap: true, shopSuppliesTaxable: true } }),
      prisma.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`),
      prisma.customer.findFirst({ where: { shopId: SHOP_ID, legacyCustno: "87612072" }, select: { id: true, displayName: true } }),
      prisma.vehicle.findFirst({ where: { shopId: SHOP_ID, legacyCarno: "87612073" }, select: { id: true, customerId: true, year: true, make: true, model: true } }),
      prisma.repairOrder.count({ where: { shopId: SHOP_ID, OR: [{ legacyRoNo: "21775" }, { repairOrderNumber: 21775 }] } }),
      prisma.repairOrder.count({ where: { shopId: SHOP_ID, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } } }),
      prisma.repairOrder.findFirst({ where: { shopId: SHOP_ID, legacyRoNo: "21773" }, select: { id: true, updatedAt: true, status: true, customerId: true, vehicleId: true, openedAt: true, odometer: true } }),
      financialControls(prisma),
    ]);
    const appliedNames = new Set(applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
    if (!shop || shop.name !== SHOP_NAME) throw new Error("Production Shop identity mismatch.");
    if (migrationDirectories.some((name) => !appliedNames.has(name)) || applied.some((row) => !row.finished_at && !row.rolled_back_at)) throw new Error("Prisma migrations are not current.");
    if (existing !== 0 || openCount !== 1 || !ro21773) throw new Error("Production Repair Order preconditions changed.");
    if (!customer || customer.displayName !== "NAIMY" || !vehicle || vehicle.customerId !== customer.id || vehicle.year !== 2005 || vehicle.make !== "ACURA" || vehicle.model !== "RSX") throw new Error("Production Customer/Vehicle identity mismatch.");
    const baseline = { identity, shop: { id: shop.id, name: shop.name }, migrationsCurrent: true, openCount, ro21773, before, artifactSha256: validation.artifactSha256 };
    console.log(JSON.stringify({ mode: confirmed ? "CONFIRMED_WRITE" : "DRY_RUN", baseline }, null, 2));
    if (!confirmed) return;
    const created = await prisma.$transaction(async (tx) => {
      if (await tx.repairOrder.count({ where: { shopId: SHOP_ID, OR: [{ legacyRoNo: "21775" }, { repairOrderNumber: 21775 }] } })) throw new Error("RO 21775 appeared concurrently.");
      if (await tx.repairOrder.count({ where: { shopId: SHOP_ID, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } } }) !== 1) throw new Error("Operational RO count changed concurrently.");
      const order = await tx.repairOrder.create({ data: { shopId: SHOP_ID, customerId: customer.id, vehicleId: vehicle.id, status: "open", openedAt: new Date("2026-08-29T00:00:00.000Z"), odometer: 91705, repairOrderNumber: 21775, legacyRoNo: "21775", legacySourceTable: null, partsTotal: 0, laborTotal: 0, taxTotal: 0, estimatedTotal: 0, shopSuppliesEnabledSnapshot: shop.shopSuppliesEnabled, shopSuppliesRateSnapshot: shop.shopSuppliesRate, shopSuppliesCapSnapshot: shop.shopSuppliesCap, shopSuppliesTaxableSnapshot: shop.shopSuppliesTaxable, shopSuppliesEligibleLaborTotal: 0, shopSuppliesCalculatedAmount: 0, shopSuppliesAmount: 0 }, select: { id: true } });
      if (shop.nextRepairOrderNumber <= 21775) await tx.shop.update({ where: { id: SHOP_ID }, data: { nextRepairOrderNumber: 21776 } });
      return order;
    });
    const [after, openOrders, ro21773After, ro21775] = await Promise.all([
      financialControls(prisma),
      prisma.repairOrder.findMany({ where: { shopId: SHOP_ID, status: { in: ["draft", "open"] }, legacySourceTable: null, invoices: { none: {} } }, orderBy: [{ repairOrderNumber: "desc" }], select: { legacyRoNo: true, repairOrderNumber: true, status: true, odometer: true, customer: { select: { legacyCustno: true, displayName: true } }, vehicle: { select: { legacyCarno: true } }, _count: { select: { parts: true, labor: true } } } }),
      prisma.repairOrder.findUnique({ where: { id: ro21773.id }, select: { id: true, updatedAt: true, status: true, customerId: true, vehicleId: true, openedAt: true, odometer: true } }),
      prisma.repairOrder.findUnique({ where: { id: created.id }, select: { id: true, legacyRoNo: true, repairOrderNumber: true, status: true, openedAt: true, odometer: true, legacySourceTable: true, customer: { select: { legacyCustno: true, displayName: true } }, vehicle: { select: { legacyCarno: true, year: true, make: true, model: true } }, _count: { select: { parts: true, labor: true, invoices: true } } } }),
    ]);
    if (!exact(before, after) || !exact(ro21773, ro21773After) || openOrders.length !== 2 || ro21775?._count.parts !== 0 || ro21775?._count.labor !== 0) throw new Error("Post-write invariant verification failed.");
    console.log(JSON.stringify({ result: "COMPLETED", after, openOrders, ro21773Unchanged: true, ro21775 }, null, 2));
  } finally { await prisma.$disconnect(); }
}

const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshotManifestPath = option("--snapshot-manifest");
const createOutput = option("--create-approval", false);
if (createOutput) await createApproval(snapshotManifestPath, createOutput);
else {
  const artifact = option("--approval");
  const confirmation = option("--confirm", false);
  if (confirmation && confirmation !== CONFIRMATION) throw new Error(`--confirm must equal ${CONFIRMATION}.`);
  await operationalize(snapshotManifestPath, artifact, confirmation === CONFIRMATION);
}
