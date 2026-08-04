import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  executeInvoiceOdometerBackfill,
  parseInvoiceOdometerBackfillArguments,
  projectInvoiceOdometerBackfill,
} from "./lib/legacy-odometer.mjs";

const options = parseInvoiceOdometerBackfillArguments(process.argv.slice(2));
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const importRun = await prisma.legacyImportRun.findFirst({
    where: { id: options.importRunId, shopId: options.shopId },
    select: { id: true },
  });
  if (!importRun) throw new Error("The selected import run does not belong to the selected shop.");
  const [rawRows, invoices] = await Promise.all([
    prisma.rawLegacyAr.findMany({ where: { shopId: options.shopId, legacyImportRunId: options.importRunId }, select: { shopId: true, legacyRoNo: true, rawData: true } }),
    prisma.invoice.findMany({ where: { shopId: options.shopId, legacyRoNo: { not: null } }, select: { id: true, shopId: true, legacyRoNo: true, odometer: true } }),
  ]);
  const plan = projectInvoiceOdometerBackfill({ shopId: options.shopId, rawRows, invoices });
  console.log(JSON.stringify({ mode: options.dryRun ? "dry-run" : "confirmed", ...plan, updates: undefined }, null, 2));
  const result = await executeInvoiceOdometerBackfill({
    confirmed: options.confirmed,
    plan,
    update: async (row) => {
      const result = await prisma.invoice.updateMany({ where: { id: row.id, shopId: row.shopId, legacyRoNo: row.legacyRoNo }, data: { odometer: row.odometer } });
      if (result.count !== 1) throw new Error("An exact shop-scoped Invoice match changed during backfill.");
      return result.count;
    },
  });
  console.log(`database writes: ${result.databaseWrites}`);
} finally {
  await prisma.$disconnect();
}
