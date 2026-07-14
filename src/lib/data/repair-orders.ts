import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getRepairOrderFormOptions() {
  const { membership } = await getCurrentMembership();
  if (!membership) return [];

  return prisma.customer.findMany({
    where: { shopId: membership.shopId },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
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
    },
  });
}

export async function getWebRepairOrderForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return prisma.repairOrder.findFirst({
    where: {
      id,
      shopId: membership.shopId,
      legacySourceTable: null,
      status: { in: ["draft", "open"] },
    },
    select: {
      id: true,
      repairOrderNumber: true,
      status: true,
      openedAt: true,
      partsTotal: true,
      laborTotal: true,
      taxTotal: true,
      estimatedTotal: true,
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
        select: {
          id: true,
          displayName: true,
          phone: true,
          email: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
        },
      },
      vehicle: {
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          licensePlate: true,
          vin: true,
          odometer: true,
        },
      },
      parts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
        },
      },
      labor: {
        orderBy: { createdAt: "asc" },
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
