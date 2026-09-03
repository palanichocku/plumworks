import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";
import { customerLifecycleWhere, type LifecycleFilter } from "@/lib/customer-vehicle-lifecycle";

export async function getCustomersForCurrentShop(search?: string, page = 1, lifecycle: LifecycleFilter = "active") {
  const { membership } = await getCurrentMembership();

  if (!membership) {
    return { customers: [], hasNext: false };
  }

  const query = search?.trim();

  const customers = await prisma.customer.findMany({
    where: {
      shopId: membership.shopId,
      ...customerLifecycleWhere(lifecycle),
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { phone2: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 50,
    take: 51,
    select: {
      id: true,
      displayName: true,
      email: true,
      phone: true,
      archivedAt: true,
    },
  });

  return { customers: customers.slice(0, 50), hasNext: customers.length > 50 };
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
      phone2: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      legacyCustno: true,
      archivedAt: true,
      notes: true,
      legacySourceTable: true,
      _count: { select: { vehicles: true, repairOrders: true, invoices: true, payments: true, accountsReceivable: true, legacyAliases: true } },
      vehicles: {
        orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          licensePlate: true,
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
          vehicle: {
            select: { id: true, year: true, make: true, model: true },
          },
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
          vehicle: { select: { id: true, year: true, make: true, model: true } },
        },
      },
    },
  });
}

export async function getCustomerForEdit(id: string) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return prisma.customer.findFirst({
    where: { id, shopId: membership.shopId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      phone: true,
      phone2: true,
      email: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });
}
