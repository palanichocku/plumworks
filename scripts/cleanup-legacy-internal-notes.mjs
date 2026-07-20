import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { affectedNotesIntegrity, assertCleanupCounts, assertCleanupIntegrity, classifyLegacyNotes, LEGACY_RECOVERY_PREFIX, OBJECT_NOTE, parseLegacyNotesCleanupArguments, runLegacyNotesCleanup } from "./lib/legacy-notes-cleanup.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const execFileAsync = promisify(execFile);
const options = parseLegacyNotesCleanupArguments(process.argv.slice(2));
const databaseUrl = process.env.DIRECT_URL;
if (!databaseUrl) throw new Error("Legacy notes cleanup failed: DIRECT_URL is not configured.");

const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const checksum = (value) => createHash("sha256").update(value).digest("hex");

async function loadRows(client, shopId) {
  const [customers, vehicles] = await Promise.all([
    client.customer.findMany({ where: { shopId, notes: { not: null } }, orderBy: { id: "asc" } }),
    client.vehicle.findMany({ where: { shopId, notes: { not: null } }, orderBy: { id: "asc" } }),
  ]);
  return { customers, vehicles };
}

async function createBackup(shopId, classification) {
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  const directory = join(homedir(), "Projects", "Web", "plumworks-backups", "cardoc", "legacy-notes-cleanup", timestamp);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const affected = { customers: classification.affectedCustomers, vehicles: classification.affectedVehicles };
  const affectedJson = serialize(affected);
  const affectedFile = join(directory, "affected-records.json");
  await writeFile(affectedFile, affectedJson, { mode: 0o600, flag: "wx" });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
  const manifest = { createdAt: new Date().toISOString(), gitCommit: stdout.trim(), shopId, affectedCustomerIds: classification.affectedCustomers.map(({ id }) => id), affectedVehicleIds: classification.affectedVehicles.map(({ id }) => id), affectedRecordsFile: "affected-records.json", affectedRecordsSha256: checksum(affectedJson), credentialsStored: false };
  const manifestFile = join(directory, "manifest.json");
  await writeFile(manifestFile, serialize(manifest), { mode: 0o600, flag: "wx" });
  await Promise.all([chmod(affectedFile, 0o600), chmod(manifestFile, 0o600)]);
  return { directory, checksum: manifest.affectedRecordsSha256 };
}

function report(classification) {
  console.log(`Customers with recovery metadata notes: ${classification.affectedCustomers.length}`);
  console.log(`Vehicles with object-string notes: ${classification.affectedVehicles.length}`);
  console.log(`Customers with other nonblank notes preserved: ${classification.preservedCustomers.length}`);
  console.log(`Vehicles with other nonblank notes preserved: ${classification.preservedVehicles.length}`);
  console.log(`Customer note records by provenance: legacy ${classification.customerProvenance.legacy}; web ${classification.customerProvenance.web}`);
  console.log(`Vehicle note records by provenance: legacy ${classification.vehicleProvenance.legacy}; web ${classification.vehicleProvenance.web}`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const shopId = await resolveSingleShopId(prisma);
  const rows = await loadRows(prisma, shopId);
  const classification = classifyLegacyNotes(rows.customers, rows.vehicles);
  const expectedIntegrity = affectedNotesIntegrity(classification.affectedCustomers, classification.affectedVehicles);
  report(classification);
  if (options.dryRun) {
    console.log("No database changes performed.");
  } else {
    const completed = await runLegacyNotesCleanup({ createBackup: () => createBackup(shopId, classification), transaction: () => prisma.$transaction(async (transaction) => {
      const [currentCustomers, currentVehicles] = await Promise.all([
        transaction.customer.findMany({ where: { shopId, notes: { startsWith: LEGACY_RECOVERY_PREFIX } }, orderBy: { id: "asc" }, select: { id: true, shopId: true, notes: true } }),
        transaction.$queryRaw`SELECT "id", "shop_id" AS "shopId", "notes" FROM "vehicles" WHERE "shop_id" = ${shopId}::uuid AND btrim("notes") = ${OBJECT_NOTE} ORDER BY "id" ASC`,
      ]);
      assertCleanupIntegrity(expectedIntegrity, affectedNotesIntegrity(currentCustomers, currentVehicles));
      const expectedCustomers = currentCustomers.length;
      const expectedVehicles = currentVehicles.length;
      const customerResult = await transaction.customer.updateMany({ where: { shopId, notes: { startsWith: LEGACY_RECOVERY_PREFIX } }, data: { notes: null } });
      const vehiclesUpdated = await transaction.$executeRaw`UPDATE "vehicles" SET "notes" = NULL, "updated_at" = NOW() WHERE "shop_id" = ${shopId}::uuid AND btrim("notes") = ${OBJECT_NOTE}`;
      const [remainingCustomers, remainingVehicleRows] = await Promise.all([
        transaction.customer.count({ where: { shopId, notes: { startsWith: LEGACY_RECOVERY_PREFIX } } }),
        transaction.$queryRaw`SELECT COUNT(*)::int AS "count" FROM "vehicles" WHERE "shop_id" = ${shopId}::uuid AND btrim("notes") = ${OBJECT_NOTE}`,
      ]);
      const remainingVehicles = remainingVehicleRows[0]?.count ?? -1;
      assertCleanupCounts(expectedCustomers, customerResult.count, expectedVehicles, vehiclesUpdated, remainingCustomers, remainingVehicles);
      const customersUpdated = customerResult.count;
      return { customersUpdated, vehiclesUpdated };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 }) });
    console.log(`Backup directory: ${completed.checkpoint.directory}`);
    console.log(`Backup SHA-256: ${completed.checkpoint.checksum}`);
    console.log(`Customers updated: ${completed.result.customersUpdated}`);
    console.log(`Vehicles updated: ${completed.result.vehiclesUpdated}`);
  }
} finally {
  await prisma.$disconnect();
}
