import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  assertVendorBackfillWritable,
  buildInvoicePartVendorBackfillPlan,
  executeVendorUpdateTransaction,
  parseInvoicePartVendorBackfillArguments,
  projectLegacyFinalPartLines,
} from "./lib/invoice-part-vendor-backfill.mjs";

const options = parseInvoicePartVendorBackfillArguments(process.argv.slice(2));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function report(plan, databaseWrites) {
  console.log(`source part lines evaluated: ${plan.sourceLinesEvaluated}`);
  console.log(`source Vendor values: ${plan.sourceVendorValues}`);
  console.log(`matched destination lines: ${plan.matchedDestinationLines}`);
  console.log(`already correct: ${plan.alreadyCorrect}`);
  console.log(`proposed updates: ${plan.proposedUpdates}`);
  console.log(`missing source Vendor: ${plan.missingSourceVendor}`);
  console.log(`conflicts: ${plan.conflicts}`);
  console.log(`unresolved: ${plan.unresolved}`);
  console.log(`ambiguous: ${plan.ambiguous}`);
  console.log(`database writes: ${databaseWrites}`);
}

async function updateVendorBatch(transaction, shopId, batch) {
  const plannedRows = Prisma.join(
    batch.map(({ id, vendorNameSnapshot }) =>
      Prisma.sql`(${id}::uuid, ${vendorNameSnapshot}::text)`),
  );
  return transaction.$executeRaw(Prisma.sql`
    UPDATE invoice_parts AS destination
    SET vendor_name_snapshot = planned.vendor_name_snapshot
    FROM (VALUES ${plannedRows}) AS planned(id, vendor_name_snapshot)
    WHERE destination.id = planned.id
      AND destination.shop_id = ${shopId}::uuid
      AND (
        destination.vendor_name_snapshot IS NULL
        OR btrim(destination.vendor_name_snapshot) = ''
      )
  `);
}

async function main() {
  try {
    const importRun = await prisma.legacyImportRun.findFirst({
      where: { id: options.importRunId, shopId: options.shopId },
      select: { id: true },
    });
    if (!importRun) throw new Error("The specified legacy import run does not belong to the specified shop.");

    const [sourceRows, importedInvoices, destinationLines] = await Promise.all([
      prisma.rawLegacyFinal.findMany({
        where: { shopId: options.shopId, legacyImportRunId: options.importRunId },
        select: { id: true, legacyRoNo: true, rawData: true },
        orderBy: { id: "asc" },
      }),
      prisma.invoice.findMany({
        where: { shopId: options.shopId, legacyRoNo: { not: null } },
        select: { legacyRoNo: true },
      }),
      prisma.invoicePart.findMany({
        where: { shopId: options.shopId, legacySourceTable: "FINAL.DBF" },
        select: { id: true, legacyLineKey: true, vendorNameSnapshot: true },
      }),
    ]);
    const importedRepairOrders = new Set(importedInvoices.map(({ legacyRoNo }) => legacyRoNo));
    const sourceLines = projectLegacyFinalPartLines(sourceRows).filter(
      ({ legacyRoNo }) => importedRepairOrders.has(legacyRoNo),
    );
    const plan = buildInvoicePartVendorBackfillPlan(sourceLines, destinationLines);

    if (!options.confirmedWrite) {
      report(plan, 0);
      return;
    }
    assertVendorBackfillWritable(plan);
    const writes = await executeVendorUpdateTransaction({
      prisma,
      shopId: options.shopId,
      updates: plan.updates,
      updateBatch: updateVendorBatch,
    });
    report(plan, writes);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error && error.message.startsWith("Vendor backfill")
    ? error.message
    : "Vendor backfill failed safely; no changes were committed.";
  console.error(message);
  process.exitCode = 1;
}
