import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getCustomersForCurrentShop(search?: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return [];
  }

  const query = search?.trim();

  return prisma.customer.findMany({
    where: {
      shopId: membership.shopId,
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: 50,
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
    },
  });
}

export async function getCustomerForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return null;
  }

  return prisma.customer.findFirst({
    where: {
      id,
      shopId: membership.shopId,
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      legacyCustno: true,
      vehicles: {
        orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          licensePlate: true,
        },
      },
      invoices: {
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: {
          id: true,
          legacyRoNo: true,
          invoiceDate: true,
          total: true,
          vehicle: {
            select: { id: true, year: true, make: true, model: true },
          },
        },
      },
    },
  });
}
