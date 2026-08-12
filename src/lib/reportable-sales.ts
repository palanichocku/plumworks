import type { Prisma } from "@/generated/prisma/client";

type ReportRange = { start: Date; endExclusive: Date };

type SaleDateInput = {
  legacySourceTable: string | null;
  status: string;
  invoiceDate: Date | null;
  closedAt: Date | null;
};

export function reportableSaleWhere(shopId: string, range: ReportRange): Prisma.InvoiceWhereInput {
  return {
    shopId,
    OR: [
      {
        legacySourceTable: null,
        status: "closed",
        closedAt: { gte: range.start, lt: range.endExclusive },
      },
      {
        legacySourceTable: { not: null },
        invoiceDate: { gte: range.start, lt: range.endExclusive },
      },
    ],
  };
}

export function reportingDateForSale(invoice: SaleDateInput) {
  return invoice.legacySourceTable === null ? invoice.closedAt : invoice.invoiceDate;
}

export function isReportableSaleInRange(invoice: SaleDateInput, range: ReportRange) {
  const reportingDate = reportingDateForSale(invoice);
  if (!reportingDate) return false;
  if (invoice.legacySourceTable === null && invoice.status !== "closed") return false;
  return reportingDate >= range.start && reportingDate < range.endExclusive;
}
