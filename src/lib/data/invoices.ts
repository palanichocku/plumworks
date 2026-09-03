import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export const invoiceBusinessOrderSql = Prisma.sql`
  i.invoice_date DESC NULLS LAST,
  COALESCE(i.repair_order_number::bigint,
    CASE WHEN i.legacy_ro_no ~ '^[0-9]+$' THEN i.legacy_ro_no::bigint END
  ) DESC NULLS LAST,
  i.repair_order_number DESC NULLS LAST,
  i.legacy_ro_no DESC NULLS LAST,
  i.id DESC
`;

export async function getInvoicesForCurrentShop(search?: string, page = 1) {
  const { membership } = await getCurrentMembership();

  if (!membership) return { invoices: [], hasNext: false };

  const query = search?.trim();

  const searchClause = query ? Prisma.sql`AND (
    i.legacy_ro_no ILIKE ${`%${query}%`}
    OR (${/^\d+$/.test(query)} AND i.repair_order_number = ${/^\d+$/.test(query) ? Number(query) : -1})
    OR c.display_name ILIKE ${`%${query}%`}
    OR v.make ILIKE ${`%${query}%`}
    OR v.model ILIKE ${`%${query}%`}
    OR v.license_plate ILIKE ${`%${query}%`}
  )` : Prisma.empty;
  const orderedIds = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT i.id
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    LEFT JOIN vehicles v ON v.id = i.vehicle_id
    WHERE i.shop_id = ${membership.shopId}::uuid
    ${searchClause}
    ORDER BY ${invoiceBusinessOrderSql}
    OFFSET ${(page - 1) * 50}
    LIMIT 51
  `);
  const pageIds = orderedIds.slice(0, 50).map(({ id }) => id);
  const rows = await prisma.invoice.findMany({
    where: {
      shopId: membership.shopId, id: { in: pageIds },
    },
    select: {
      id: true,
      legacyRoNo: true,
      legacySourceTable: true,
      repairOrderNumber: true,
      invoiceDate: true,
      status: true,
      closedAt: true,
      deliveredAt: true,
      closedByUserId: true,
      voidedAt: true,
      voidedByUserId: true,
      voidReason: true,
      voidNote: true,
      customerComplaint: true,
      recommendation: true,
      total: true,
      customer: { select: { id: true, displayName: true } },
      vehicle: {
        select: { id: true, year: true, make: true, model: true },
      },
      accountsReceivable: {
        take: 1,
        select: { balance: true },
      },
    },
  });

  const byId = new Map(rows.map((invoice) => [invoice.id, invoice]));
  return { invoices: pageIds.flatMap((id) => byId.get(id) ?? []), hasNext: orderedIds.length > 50 };
}

export async function getInvoiceForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) return null;

  return prisma.invoice.findFirst({
    where: { id, shopId: membership.shopId },
    select: {
      id: true,
      legacyRoNo: true,
      repairOrderNumber: true,
      legacySourceTable: true,
      shopSnapshot: true,
      customerSnapshot: true,
      vehicleSnapshot: true,
      invoiceDate: true,
      status: true,
      closedAt: true,
      deliveredAt: true,
      closedByUserId: true,
      voidedAt: true,
      voidedByUserId: true,
      voidReason: true,
      voidNote: true,
      customerComplaint: true,
      recommendation: true,
      partsTotal: true,
      laborTotal: true,
      subtotal: true,
      discountAmount: true,
      shopSuppliesAmount: true,
      taxTotal: true,
      total: true,
      paidTotal: true,
      shop: {
        select: {
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          defaultTaxRate: true,
          partsTaxable: true,
          laborTaxable: true,
          vendors: { orderBy: { name: "asc" }, select: { id: true, name: true } },
        },
      },
      customer: {
        select: { id: true, displayName: true, email: true },
      },
      vehicle: {
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          odometer: true,
        },
      },
      accountsReceivable: {
        take: 1,
        select: { balance: true, status: true, dueAt: true },
      },
      payments: {
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          paidAt: true,
          method: true,
          payerType: true,
          amount: true,
          reference: true,
          note: true,
        },
      },
      parts: {
        orderBy: { id: "asc" },
        take: 50,
        select: {
          id: true,
          description: true,
          partNumber: true,
          quantity: true,
          unitPrice: true,
          vendorNameSnapshot: true,
        },
      },
      labor: {
        orderBy: { id: "asc" },
        take: 50,
        select: {
          id: true,
          description: true,
          hours: true,
          hourlyRate: true,
          complimentary: true,
          shopSuppliesEligible: true,
        },
      },
    },
  });
}
