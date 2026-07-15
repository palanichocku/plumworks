import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getDashboardSummary() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  const shopId = membership.shopId;
  const recentSince = new Date();
  recentSince.setUTCDate(recentSince.getUTCDate() - 30);

  const [openRepairOrders, webRepairOrders, openReceivables, customers, vehicles, recentInvoiceCount, recentRepairOrders, recentInvoices, unpaidInvoices] = await Promise.all([
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] } } }),
    prisma.repairOrder.count({ where: { shopId, status: { in: ["draft", "open"] }, legacySourceTable: null, repairOrderNumber: { not: null } } }),
    prisma.accountReceivable.aggregate({ where: { shopId, status: "open", balance: { gt: 0 } }, _count: true, _sum: { balance: true } }),
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.invoice.count({ where: { shopId, invoiceDate: { gte: recentSince } } }),
    prisma.repairOrder.findMany({
      where: { shopId, status: { in: ["draft", "open"] } },
      orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, legacySourceTable: true, status: true, openedAt: true, customer: { select: { displayName: true } } },
    }),
    prisma.invoice.findMany({
      where: { shopId },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, invoiceDate: true, total: true, customer: { select: { displayName: true } } },
    }),
    prisma.accountReceivable.findMany({
      where: { shopId, status: "open", balance: { gt: 0 }, invoiceId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, balance: true, customer: { select: { displayName: true } }, invoice: { select: { id: true, repairOrderNumber: true, legacyRoNo: true, invoiceDate: true } } },
    }),
  ]);

  return {
    openRepairOrders,
    webRepairOrders,
    openReceivables: openReceivables._count,
    openReceivableBalance: openReceivables._sum.balance,
    customers,
    vehicles,
    recentInvoiceCount,
    recentRepairOrders,
    recentInvoices,
    unpaidInvoices,
  };
}
