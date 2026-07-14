import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export type ReceivableFilter = "open" | "paid" | "all";

export async function getAccountsReceivableForCurrentShop(
  filter: ReceivableFilter = "open",
  search?: string,
) {
  const { membership } = await getCurrentMembership();
  if (!membership) return [];
  const query = search?.trim();
  const numericRo = query && /^\d+$/.test(query) ? Number(query) : null;

  return prisma.accountReceivable.findMany({
    where: {
      shopId: membership.shopId,
      invoiceId: { not: null },
      ...(filter === "all" ? {} : { status: filter }),
      ...(query ? {
        OR: [
          { legacyRoNo: { contains: query, mode: "insensitive" } },
          { customer: { is: { displayName: { contains: query, mode: "insensitive" } } } },
          { invoice: { is: { legacyRoNo: { contains: query, mode: "insensitive" } } } },
          ...(numericRo === null ? [] : [{ invoice: { is: { repairOrderNumber: numericRo } } }]),
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      balance: true,
      status: true,
      customer: { select: { displayName: true } },
      invoice: {
        select: {
          id: true,
          legacyRoNo: true,
          repairOrderNumber: true,
          invoiceDate: true,
          total: true,
          paidTotal: true,
          vehicle: { select: { year: true, make: true, model: true } },
        },
      },
    },
  });
}
