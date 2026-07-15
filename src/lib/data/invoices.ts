import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getInvoicesForCurrentShop(search?: string, page = 1) {
  const { membership } = await getCurrentMembership();

  if (!membership) return { invoices: [], hasNext: false };

  const query = search?.trim();

  const invoices = await prisma.invoice.findMany({
    where: {
      shopId: membership.shopId,
      ...(query
        ? {
            OR: [
              { legacyRoNo: { contains: query, mode: "insensitive" as const } },
              ...(/^\d+$/.test(query)
                ? [{ repairOrderNumber: Number(query) }]
                : []),
              {
                customer: {
                  is: {
                    displayName: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
              {
                vehicle: {
                  is: {
                    OR: [
                      { make: { contains: query, mode: "insensitive" as const } },
                      { model: { contains: query, mode: "insensitive" as const } },
                      {
                        licensePlate: {
                          contains: query,
                          mode: "insensitive" as const,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 50,
    take: 51,
    select: {
      id: true,
      legacyRoNo: true,
      legacySourceTable: true,
      repairOrderNumber: true,
      invoiceDate: true,
      status: true,
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

  return { invoices: invoices.slice(0, 50), hasNext: invoices.length > 50 };
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
      partsTotal: true,
      laborTotal: true,
      subtotal: true,
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
        },
      },
      customer: {
        select: { id: true, displayName: true },
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
          amount: true,
          reference: true,
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
        },
      },
    },
  });
}
