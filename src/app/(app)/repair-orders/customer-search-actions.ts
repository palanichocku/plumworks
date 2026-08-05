"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import {
  normalizeRepairOrderCustomerQuery,
  REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT,
} from "@/lib/repair-order-customer-search";

export type RepairOrderCustomerSearchResult = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  vehicles: Array<{
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    licensePlate: string | null;
    notes: string | null;
  }>;
};

export async function searchRepairOrderCustomers(value: string): Promise<RepairOrderCustomerSearchResult[]> {
  const query = normalizeRepairOrderCustomerQuery(value);
  if (!query) return [];
  const { membership } = await getCurrentMembership();
  if (!membership) return [];

  return prisma.customer.findMany({
    where: {
      shopId: membership.shopId,
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
        { phone2: { contains: query } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { displayName: "asc" }, { id: "desc" }],
    take: REPAIR_ORDER_CUSTOMER_SEARCH_LIMIT,
    select: {
      id: true,
      displayName: true,
      phone: true,
      email: true,
      notes: true,
      vehicles: {
        orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
        select: { id: true, year: true, make: true, model: true, licensePlate: true, notes: true },
      },
    },
  });
}
