import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";
import { type LifecycleFilter, vehicleLifecycleWhere } from "@/lib/customer-vehicle-lifecycle";

export async function getVehiclesForCurrentShop(search?: string, page = 1, lifecycle: LifecycleFilter = "active") {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return { vehicles: [], hasNext: false };
  }

  const query = search?.trim();
  const vehicles = await prisma.vehicle.findMany({
    where: {
      shopId: membership.shopId,
      ...vehicleLifecycleWhere(lifecycle),
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
      archivedAt: true,
      customer: { select: { archivedAt: true } },
    },
  });

  return { vehicles: vehicles.slice(0, 50), hasNext: vehicles.length > 50 };
}

export async function getVehicleForEdit(id: string) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return prisma.vehicle.findFirst({
    where: { id, shopId: membership.shopId, archivedAt: null, customer: { archivedAt: null } },
    select: {
      id: true,
      year: true,
      make: true,
      model: true,
      engine: true,
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
      engine: true,
      vin: true,
      licensePlate: true,
      odometer: true,
      legacyCarno: true,
      archivedAt: true,
      notes: true,
      legacySourceTable: true,
      _count: { select: { repairOrders: true, invoices: true } },
      customer: {
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          archivedAt: true,
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
          status: true,
          total: true,
          parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, partNumber: true, vendorNameSnapshot: true } },
          customer: { select: { id: true, displayName: true } },
        },
      },
      repairOrders: {
        where: { invoices: { none: {} } },
        orderBy: [{ openedAt: "desc" }, { createdAt: "desc" }],
        take: 50,
        select: {
          id: true, legacyRoNo: true, repairOrderNumber: true, openedAt: true,
          estimatedTotal: true, status: true, odometer: true, legacySourceTable: true,
          parts: { orderBy: { createdAt: "asc" }, select: { id: true, description: true, partNumber: true, vendorNameSnapshot: true } },
          customer: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}
