import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";
import { hasPermission } from "@/lib/permissions";
import { callClickMessage } from "@/lib/marketing-lead-context";
import { currentUtcMonthRange } from "@/lib/dashboard-summary";
import { operationalRepairOrderWhere } from "@/lib/repair-order-lifecycle";
import { CLOSED_INVOICE_STATUS, OPEN_INVOICE_STATUS } from "@/lib/invoice-lifecycle";
import { activeCustomerAvailability, activeVehicleAvailability } from "@/lib/customer-vehicle-lifecycle";
import { averageInvoice, agedRepairOrderCutoff, exclusiveMonthRanges, percentageChange } from "@/lib/dashboard-business-overview";
import { reportableSaleWhere } from "@/lib/reportable-sales";
import { Prisma } from "@prisma/client";
import { getCurrentMonthCustomerActivityForShop } from "./customer-activity";

export async function getDashboardSummary() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  const shopId = membership.shopId;
  const now = new Date();
  const currentMonth = currentUtcMonthRange(now);
  const overviewMonths = exclusiveMonthRanges(now);

  const canViewAdmin = hasPermission(membership.role, "edit_shop_settings");
  const [openRepairOrders, customers, vehicles, monthlyInvoices, inProgressInvoices, closedInvoices, newLeadCount, currentSales, previousSales, customerActivity, agedOpenRepairOrders] = await Promise.all([
    prisma.repairOrder.count({ where: operationalRepairOrderWhere(shopId) }),
    prisma.customer.count({ where: { shopId, ...activeCustomerAvailability } }),
    prisma.vehicle.count({ where: { shopId, ...activeVehicleAvailability } }),
    prisma.invoice.aggregate({
      where: { shopId, status: { not: "void" }, invoiceDate: { gte: currentMonth.start, lt: currentMonth.endExclusive } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.invoice.findMany({
      where: { shopId, status: OPEN_INVOICE_STATUS },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        repairOrderNumber: true,
        legacyRoNo: true,
        invoiceDate: true,
        total: true,
        customer: { select: { displayName: true } },
        accountsReceivable: { take: 1, select: { balance: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { shopId, status: CLOSED_INVOICE_STATUS },
      orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, closedAt: true, total: true, customer: { select: { displayName: true } } },
    }),
    canViewAdmin ? prisma.marketingLead.count({
      where: { shopId, status: "NEW", NOT: { source: "CONTACT", message: callClickMessage } },
    }) : Promise.resolve(null),
    prisma.invoice.aggregate({
      where: reportableSaleWhere(shopId, overviewMonths.current),
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.invoice.aggregate({
      where: reportableSaleWhere(shopId, overviewMonths.previous),
      _count: { _all: true },
      _sum: { total: true },
    }),
    getCurrentMonthCustomerActivityForShop(shopId, now),
    prisma.repairOrder.count({
      where: { ...operationalRepairOrderWhere(shopId), openedAt: { lt: agedRepairOrderCutoff(now) } },
    }),
  ]);

  const currentSalesTotal = currentSales._sum.total ?? new Prisma.Decimal(0);
  const previousSalesTotal = previousSales._sum.total ?? new Prisma.Decimal(0);
  const currentAverage = averageInvoice(currentSales._sum.total, currentSales._count._all);
  const previousAverage = averageInvoice(previousSales._sum.total, previousSales._count._all);

  return {
    openRepairOrders,
    customers,
    vehicles,
    monthlyInvoiceCount: monthlyInvoices._count._all,
    monthlyInvoiceTotal: monthlyInvoices._sum.total,
    inProgressInvoices,
    closedInvoices,
    newLeadCount,
    businessOverview: {
      salesThisMonth: currentSalesTotal,
      salesPreviousMonth: previousSalesTotal,
      salesChangePercent: percentageChange(currentSalesTotal, previousSalesTotal),
      averageInvoiceThisMonth: currentAverage,
      averageInvoicePreviousMonth: previousAverage,
      averageInvoiceChangePercent: percentageChange(currentAverage, previousAverage),
      returningCustomers: customerActivity.returningCustomers,
      newCustomers: customerActivity.newCustomerCount,
      customersServiced: customerActivity.customersServiced,
      returningCustomerRate: customerActivity.returningCustomerRate,
      agedOpenRepairOrders,
    },
  };
}
