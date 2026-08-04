import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";
import { hasPermission } from "@/lib/permissions";
import { callClickMessage } from "@/lib/marketing-lead-context";
import { currentUtcMonthRange } from "@/lib/dashboard-summary";
import { operationalRepairOrderWhere } from "@/lib/repair-order-lifecycle";

export async function getDashboardSummary() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  const shopId = membership.shopId;
  const currentMonth = currentUtcMonthRange();

  const canViewAdmin = hasPermission(membership.role, "edit_shop_settings");
  const [openRepairOrders, customers, vehicles, monthlyInvoices, recentRepairOrders, recentInvoices, newLeadCount] = await Promise.all([
    prisma.repairOrder.count({ where: operationalRepairOrderWhere(shopId) }),
    prisma.customer.count({ where: { shopId } }),
    prisma.vehicle.count({ where: { shopId } }),
    prisma.invoice.aggregate({
      where: { shopId, invoiceDate: { gte: currentMonth.start, lt: currentMonth.endExclusive } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.repairOrder.findMany({
      where: operationalRepairOrderWhere(shopId),
      orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, status: true, openedAt: true, customer: { select: { displayName: true } } },
    }),
    prisma.invoice.findMany({
      where: { shopId },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, invoiceDate: true, total: true, customer: { select: { displayName: true } } },
    }),
    canViewAdmin ? prisma.marketingLead.count({
      where: { shopId, status: "NEW", NOT: { source: "CONTACT", message: callClickMessage } },
    }) : Promise.resolve(null),
  ]);

  return {
    openRepairOrders,
    customers,
    vehicles,
    monthlyInvoiceCount: monthlyInvoices._count._all,
    monthlyInvoiceTotal: monthlyInvoices._sum.total,
    recentRepairOrders,
    recentInvoices,
    newLeadCount,
  };
}
