import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export type ReportDateRange = {
  start: Date;
  endExclusive: Date;
};

export async function getShopReport(range: ReportDateRange) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  const invoiceWhere = {
    shopId: membership.shopId,
    invoiceDate: { gte: range.start, lt: range.endExclusive },
  };
  const paymentWhere = {
    shopId: membership.shopId,
    paidAt: { gte: range.start, lt: range.endExclusive },
  };
  const openArWhere = {
    shopId: membership.shopId,
    status: "open",
    balance: { gt: 0 },
    invoiceId: { not: null },
  };

  const [invoiceTotals, paymentTotals, arTotals, invoices, payments, receivables] =
    await Promise.all([
      prisma.invoice.aggregate({
        where: invoiceWhere,
        _count: { _all: true },
        _sum: {
          total: true,
          partsTotal: true,
          laborTotal: true,
          taxTotal: true,
        },
      }),
      prisma.payment.aggregate({
        where: paymentWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.accountReceivable.aggregate({
        where: openArWhere,
        _count: { _all: true },
        _sum: { balance: true },
      }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        orderBy: [{ invoiceDate: "desc" }, { updatedAt: "desc" }],
        take: 100,
        select: {
          id: true,
          repairOrderNumber: true,
          legacyRoNo: true,
          invoiceDate: true,
          status: true,
          partsTotal: true,
          laborTotal: true,
          taxTotal: true,
          total: true,
        },
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          paidAt: true,
          method: true,
          amount: true,
          invoice: {
            select: { id: true, repairOrderNumber: true, legacyRoNo: true },
          },
        },
      }),
      prisma.accountReceivable.findMany({
        where: openArWhere,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 100,
        select: {
          id: true,
          balance: true,
          status: true,
          dueAt: true,
          invoice: {
            select: {
              id: true,
              repairOrderNumber: true,
              legacyRoNo: true,
              invoiceDate: true,
              total: true,
              paidTotal: true,
            },
          },
        },
      }),
    ]);

  return { invoiceTotals, paymentTotals, arTotals, invoices, payments, receivables };
}
