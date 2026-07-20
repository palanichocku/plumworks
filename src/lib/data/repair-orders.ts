import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export async function getRepairOrderFormOptions() {
  const { membership } = await getCurrentMembership();
  if (!membership) return { customers: [], citySuggestions: [], vehicleSuggestions: [] };

  const [customers, customerCities, vehicleSuggestions] = await Promise.all([
    prisma.customer.findMany({
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
    }),
    prisma.customer.findMany({
      where: { shopId: membership.shopId, city: { not: null } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    }),
    prisma.vehicle.findMany({
      where: {
        shopId: membership.shopId,
        OR: [{ make: { not: null } }, { model: { not: null } }],
      },
      distinct: ["make", "model"],
      select: { make: true, model: true },
      orderBy: [{ make: "asc" }, { model: "asc" }],
    }),
  ]);

  return {
    customers,
    citySuggestions: customerCities.flatMap(({ city }) => city?.trim() ? [city.trim()] : []),
    vehicleSuggestions: vehicleSuggestions.map(({ make, model }) => ({
      make: make?.trim() || null,
      model: model?.trim() || null,
    })),
  };
}

export async function getWebRepairOrderForCurrentShop(id: string) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return prisma.repairOrder.findFirst({
    where: {
      id,
      shopId: membership.shopId,
      legacySourceTable: null,
      status: { in: ["draft", "open", "finalized"] },
    },
    select: {
      id: true,
      repairOrderNumber: true,
      status: true,
      openedAt: true,
      customerComplaint: true,
      recommendation: true,
      partsTotal: true,
      laborTotal: true,
      taxTotal: true,
      estimatedTotal: true,
      shopSuppliesAmount: true,
      shop: {
        select: {
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
          defaultLaborRate: true,
          invoiceFooterMessage: true,
          warrantyText: true,
          cannedServices: {
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          },
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
