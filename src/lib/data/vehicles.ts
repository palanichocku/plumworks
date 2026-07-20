import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getVehiclesForCurrentShop(search?: string, page = 1) {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return { vehicles: [], hasNext: false };
  }

  const query = search?.trim();
  const vehicles = await prisma.vehicle.findMany({
    where: {
      shopId: membership.shopId,
      ...(query
        ? {
            OR: [
              { make: { contains: query, mode: "insensitive" as const } },
              { model: { contains: query, mode: "insensitive" as const } },
              { vin: { contains: query, mode: "insensitive" as const } },
              {
                licensePlate: {
                  contains: query,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
    skip: (page - 1) * 50,
    take: 51,
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      vin: true,
      licensePlate: true,
      odometer: true,
    },
  });

  return { vehicles: vehicles.slice(0, 50), hasNext: vehicles.length > 50 };
}

export async function getVehicleForEdit(id: string) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return prisma.vehicle.findFirst({
    where: { id, shopId: membership.shopId },
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      licensePlate: true,
      vin: true,
      odometer: true,
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
      odometer: true,
      legacyCarno: true,
      notes: true,
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
          repairOrderNumber: true,
          invoiceDate: true,
          total: true,
          customer: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}
