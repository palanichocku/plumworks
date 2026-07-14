import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getInvoicesForCurrentShop(search?: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) return [];

  const query = search?.trim();

  return prisma.invoice.findMany({
    where: {
      shopId: membership.shopId,
      ...(query
        ? {
            OR: [
              { legacyRoNo: { contains: query, mode: "insensitive" as const } },
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
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      legacyRoNo: true,
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
}

export async function getInvoiceForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) return null;

  return prisma.invoice.findFirst({
    where: { id, shopId: membership.shopId },
    select: {
      id: true,
      legacyRoNo: true,
      invoiceDate: true,
      status: true,
      subtotal: true,
      taxTotal: true,
      total: true,
      customer: {
        select: { id: true, displayName: true },
      },
      vehicle: {
        select: { id: true, year: true, make: true, model: true },
      },
      accountsReceivable: {
        take: 1,
        select: { balance: true, status: true, dueAt: true },
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
