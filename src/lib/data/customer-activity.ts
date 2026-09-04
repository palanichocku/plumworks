import "server-only";

import { prisma } from "@/lib/prisma";
import { buildCustomerActivityRows, exclusiveMonthRanges } from "@/lib/dashboard-business-overview";
import { reportableSaleBeforeWhere, reportableSaleWhere, reportingDateForSale } from "@/lib/reportable-sales";
import { getCurrentMembership } from "./membership";

export async function getCurrentMonthCustomerActivityForShop(shopId: string, now = new Date()) {
  const current = exclusiveMonthRanges(now).current;
  const invoices = await prisma.invoice.findMany({
    where: reportableSaleWhere(shopId, current),
    select: { customerId: true, total: true, legacySourceTable: true, status: true, invoiceDate: true, closedAt: true },
  });
  const customerIds = [...new Set(invoices.map(({ customerId }) => customerId))];
  if (customerIds.length === 0) return buildCustomerActivityRows([], [], new Map());
  const priorWhere = { ...reportableSaleBeforeWhere(shopId, current.start), customerId: { in: customerIds } };
  const [customers, priorNative, priorLegacy] = await Promise.all([
    prisma.customer.findMany({ where: { shopId, id: { in: customerIds } }, select: { id: true, displayName: true, _count: { select: { vehicles: true } } } }),
    prisma.invoice.groupBy({ by: ["customerId"], where: { ...priorWhere, legacySourceTable: null }, _max: { closedAt: true } }),
    prisma.invoice.groupBy({ by: ["customerId"], where: { ...priorWhere, legacySourceTable: { not: null } }, _max: { invoiceDate: true } }),
  ]);
  const priorVisits = new Map<string, Date>();
  for (const row of priorNative) if (row._max.closedAt) priorVisits.set(row.customerId, row._max.closedAt);
  for (const row of priorLegacy) {
    const date = row._max.invoiceDate;
    if (date && (!priorVisits.has(row.customerId) || date > priorVisits.get(row.customerId)!)) priorVisits.set(row.customerId, date);
  }
  return buildCustomerActivityRows(
    invoices.map((invoice) => ({ customerId: invoice.customerId, total: invoice.total, reportingDate: reportingDateForSale(invoice)! })),
    customers.map(({ id, displayName, _count }) => ({ id, displayName, vehicleCount: _count.vehicles })),
    priorVisits,
  );
}

export async function getCurrentMonthCustomerActivity(now = new Date()) {
  const { membership } = await getCurrentMembership();
  return membership ? getCurrentMonthCustomerActivityForShop(membership.shopId, now) : null;
}
