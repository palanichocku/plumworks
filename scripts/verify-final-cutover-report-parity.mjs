import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveLegacySource } from "./lib/legacy-source.mjs";
import { resolveSingleShopId } from "./lib/single-shop.mjs";
import { readLegacyDbf } from "./lib/read-legacy-report-sources.mjs";
import {
  addDestinationPayments,
  allCutoverReportPeriods,
  compareReportTotals,
  money,
  projectSourceReportInvoices,
  summarizeDestinationInvoices,
  summarizeSourcePeriod,
} from "./lib/final-cutover-report-parity.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function displayTotals(totals) {
  return {
    invoiceCount: totals.invoiceCount,
    partsTotal: money(totals.partsTotalCents),
    laborTotal: money(totals.laborTotalCents),
    subtotal: money(totals.subtotalCents),
    shopSuppliesTotal: money(totals.shopSuppliesTotalCents),
    ordinarySalesTaxTotal: money(totals.ordinarySalesTaxTotalCents),
    discountsTotal: money(totals.discountsTotalCents),
    legacyChargeTotal: money(totals.legacyChargeTotalCents),
    grossSalesTotal: money(totals.grossSalesTotalCents),
    invoicePaidTotal: money(totals.invoicePaidTotalCents),
    paymentRowCount: totals.paymentRowCount,
    paidInvoiceCount: totals.paidInvoiceCount,
    splitTenderInvoiceCount: totals.splitTenderInvoiceCount,
    cashTotal: money(totals.cashTotalCents),
    checkTotal: money(totals.checkTotalCents),
    cardTotal: money(totals.cardTotalCents),
    internalTotal: money(totals.internalTotalCents),
    otherTotal: money(totals.otherTotalCents),
    paymentTotal: money(totals.paymentTotalCents),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  const cutoverDate = argument("--cutover-date") ?? "2026-10-31";
  const source = await resolveLegacySource({ requiredFiles: ["ar.DBF", "FINAL.DBF", "laborfinal.DBF"] });
  const [ar, final, labor] = await Promise.all([
    readLegacyDbf(source.files["ar.DBF"]),
    readLegacyDbf(source.files["FINAL.DBF"]),
    readLegacyDbf(source.files["laborfinal.DBF"]),
  ]);
  const projection = projectSourceReportInvoices({ arRows: ar.rows, finalRows: final.rows, laborRows: labor.rows });
  if (projection.fatalIssues.length) {
    throw new Error(`Source report projection has ${projection.fatalIssues.length} blocking issue(s): ${JSON.stringify(projection.fatalIssues.slice(0, 10))}`);
  }
  const periods = allCutoverReportPeriods(cutoverDate, projection.invoices);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const shopId = await resolveSingleShopId(prisma, argument("--shop-id"));
    const results = [];
    for (const period of periods) {
      const sourceTotals = summarizeSourcePeriod(projection.invoices, period);
      const [destinationInvoices, destinationPayments] = await Promise.all([
        prisma.invoice.findMany({
          where: {
            shopId,
            legacySourceTable: { not: null },
            invoiceDate: { gte: period.start, lt: period.endExclusive },
          },
          select: {
            legacyRoNo: true,
            invoiceDate: true,
            partsTotal: true,
            laborTotal: true,
            subtotal: true,
            shopSuppliesAmount: true,
            taxTotal: true,
            total: true,
            paidTotal: true,
            legacyCharges: { select: { amount: true } },
          },
        }),
        prisma.payment.findMany({
          where: {
            shopId,
            legacySourceTable: "ar.DBF",
            paidAt: { gte: period.start, lt: period.endExclusive },
          },
          select: { amount: true, method: true, invoiceId: true },
        }),
      ]);
      const destinationTotals = addDestinationPayments(
        summarizeDestinationInvoices(destinationInvoices),
        destinationPayments,
      );
      const differences = compareReportTotals(sourceTotals, destinationTotals);
      results.push({
        key: period.key,
        label: period.label,
        start: period.start.toISOString().slice(0, 10),
        endExclusive: period.endExclusive.toISOString().slice(0, 10),
        status: differences.length ? "FAIL" : "PASS",
        source: displayTotals(sourceTotals),
        destination: displayTotals(destinationTotals),
        differences,
      });
    }

    const failed = results.filter((result) => result.status === "FAIL");
    console.log(JSON.stringify({
      status: failed.length ? "FAIL" : "PASS",
      cutoverDate,
      sourceFingerprint: source.fingerprint,
      sourceInvoiceCount: projection.invoices.length,
      periods: results,
    }, null, 2));
    if (failed.length) throw new Error(`Final cutover report parity failed for: ${failed.map((result) => result.key).join(", ")}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
