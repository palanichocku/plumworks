import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { resolveSingleShopId } from "./lib/single-shop.mjs";
import { parseLegacyRefreshRehearsalArguments, runLegacyRefreshRehearsal } from "./lib/legacy-refresh-rehearsal.mjs";

const COUNT_MODELS = Object.freeze([
  ["customers", "customer"], ["customerAliases", "customerLegacyAlias"], ["vehicles", "vehicle"],
  ["repairOrders", "repairOrder"], ["repairOrderParts", "repairOrderPart"], ["repairOrderLabor", "repairOrderLabor"],
  ["invoices", "invoice"], ["invoiceParts", "invoicePart"], ["invoiceLabor", "invoiceLabor"], ["payments", "payment"],
  ["accountsReceivable", "accountReceivable"], ["legacyImportRuns", "legacyImportRun"],
  ["rawLegacyCustomers", "rawLegacyCustomer"], ["rawLegacyVehicles", "rawLegacyVehicle"], ["rawLegacyFinal", "rawLegacyFinal"],
  ["rawLegacyLaborFinal", "rawLegacyLaborFinal"], ["rawLegacyAr", "rawLegacyAr"],
  ["rawLegacyOrderParts", "rawLegacyOrderPart"], ["rawLegacyOrderLabor", "rawLegacyOrderLabor"], ["operationalAuditEvents", "auditLog"],
]);
const OPERATIONAL_AUDIT_TYPES = Object.freeze([
  "customer", "vehicle", "repair_order", "repair_order_part", "repair_order_labor",
  "invoice", "payment", "accounts_receivable",
]);

async function main() {
  const options = parseLegacyRefreshRehearsalArguments(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const databaseState = async () => {
      const shopId = await resolveSingleShopId(prisma);
      const counts = Object.fromEntries(await Promise.all(COUNT_MODELS.map(async ([label, model]) => [label, await prisma[model].count({
        where: model === "auditLog" ? { shopId, entityType: { in: OPERATIONAL_AUDIT_TYPES } } : { shopId },
      })])));
      const appliedMigrations = await prisma.$queryRaw(Prisma.sql`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `);
      return { shopId, counts, appliedMigrations: appliedMigrations.map((row) => row.migration_name) };
    };
    const result = await runLegacyRefreshRehearsal(options, { databaseState });
    console.log(options.mode === "seed" ? "End-to-end seed refresh rehearsal passed with zero database writes." : "End-to-end legacy refresh rehearsal passed with zero database writes.");
    console.log(`Final Markdown report: ${result.markdownPath}`);
    console.log(`Final JSON report: ${result.jsonPath}`);
    if (result.snapshotPath) console.log(`Immutable snapshot path: ${result.snapshotPath}`);
  } finally { await prisma.$disconnect(); }
}

try { await main(); }
catch (error) {
  console.error(`Legacy refresh rehearsal failed at ${error.rehearsal?.report?.failedStage ?? "initialization"}: ${error.rehearsal?.report?.rootCause ?? error.message}`);
  if (error.rehearsal) {
    console.error(`Final Markdown report: ${error.rehearsal.markdownPath}`);
    console.error(`Final JSON report: ${error.rehearsal.jsonPath}`);
  }
  process.exitCode = 1;
}
