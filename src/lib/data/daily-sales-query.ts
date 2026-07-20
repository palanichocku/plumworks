import type { PrismaClient } from "../../generated/prisma/client";
import {
  aggregatePaymentRows,
  buildDailySalesInvoiceRows,
  buildSalesSummary,
  reconciliationDifferences,
} from "../daily-sales-aggregation";
import type { ReportDateRange } from "./reports";

export async function loadDailySalesReport(prisma: PrismaClient, shopId: string, range: ReportDateRange) {
  const invoiceWhere = {
    shopId,
    invoiceDate: { gte: range.start, lt: range.endExclusive },
  };
  const paymentWhere = {
    shopId,
    paidAt: { gte: range.start, lt: range.endExclusive },
  };
  const [invoiceAggregate, legacyChargeAggregate, paymentRows, invoices] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _count: { _all: true },
      _sum: {
        total: true,
        partsTotal: true,
        laborTotal: true,
        subtotal: true,
        shopSuppliesAmount: true,
        taxTotal: true,
        paidTotal: true,
      },
    }),
    prisma.invoiceLegacyCharge.aggregate({
      where: { invoice: invoiceWhere },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: paymentWhere,
      select: { amount: true, method: true, invoiceId: true },
    }),
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        repairOrderNumber: true,
        legacyRoNo: true,
        invoiceDate: true,
        customer: { select: { displayName: true } },
        vehicle: { select: { year: true, make: true, model: true } },
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
  ]);

  const sales = buildSalesSummary(invoiceAggregate, legacyChargeAggregate._sum.amount);
  const payments = aggregatePaymentRows(paymentRows);
  const reconciliation = reconciliationDifferences(sales, payments);
  const invoiceRows = buildDailySalesInvoiceRows(invoices, paymentRows);
  return { sales, payments, reconciliation, invoices: invoiceRows };
}
