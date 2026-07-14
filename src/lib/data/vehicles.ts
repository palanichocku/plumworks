import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getVehiclesForCurrentShop() {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return [];
  }

  return prisma.vehicle.findMany({
    where: { shopId: membership.shopId },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
    take: 50,
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      vin: true,
      licensePlate: true,
    },
  });
}

export async function getVehicleForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return null;
  }

  return prisma.vehicle.findFirst({
    where: {
      id,
      shopId: membership.shopId,
    },
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      vin: true,
      licensePlate: true,
      legacyCarno: true,
      customer: {
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
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
          customer: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}
