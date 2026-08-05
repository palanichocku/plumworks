import "server-only";

import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "./membership";

export function normalizeShopSearch(search: string) {
  const query = search.trim().replaceAll(/\s+/g, " ");
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const withoutPrefix = query
    .replace(/^(?:repair\s*order|ro|invoice|inv)\s*#?\s*/i, "")
    .replace(/^#\s*/, "")
    .trim();
  const numericText = withoutPrefix.match(/\d+/)?.[0] ?? null;
  const numericRo = numericText && Number.isSafeInteger(Number(numericText))
    ? Number(numericText)
    : null;
  return {
    query,
    tokens,
    numericRo,
    roText: (numericText ?? withoutPrefix) || query,
  };
}

export async function searchCurrentShop(search: string) {
  const { membership } = await getCurrentMembership();
  const { query, tokens, numericRo, roText } = normalizeShopSearch(search);
  if (!membership || !query) {
    return { customers: [], vehicles: [], repairOrders: [], invoices: [] };
  }
  const shopId = membership.shopId;

  const [customers, vehicles, repairOrders, invoices] = await Promise.all([
    prisma.customer.findMany({
      where: {
        shopId,
        AND: tokens.map((token) => ({
          OR: [
            { displayName: { contains: token, mode: "insensitive" as const } },
            { phone: { contains: token } },
            { phone2: { contains: token } },
          ],
        })),
      },
      orderBy: { displayName: "asc" },
      take: 10,
      select: { id: true, displayName: true, phone: true },
    }),
    prisma.vehicle.findMany({
      where: {
        shopId,
        AND: tokens.map((token) => {
          const numericToken = /^\d+$/.test(token) ? Number(token) : null;
          return {
            OR: [
              { make: { contains: token, mode: "insensitive" as const } },
              { model: { contains: token, mode: "insensitive" as const } },
              { licensePlate: { contains: token, mode: "insensitive" as const } },
              { vin: { contains: token, mode: "insensitive" as const } },
              ...(numericToken === null ? [] : [{ year: numericToken }]),
            ],
          };
        }),
      },
      orderBy: [{ year: "desc" }, { make: "asc" }, { model: "asc" }],
      take: 10,
      select: { id: true, year: true, make: true, model: true, licensePlate: true },
    }),
    prisma.repairOrder.findMany({
      where: {
        shopId,
        OR: [
          { legacyRoNo: { contains: roText, mode: "insensitive" } },
          ...(numericRo === null ? [] : [{ repairOrderNumber: numericRo }]),
        ],
      },
      orderBy: { openedAt: "desc" },
      take: 10,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, legacySourceTable: true, status: true, openedAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        shopId,
        OR: [
          { legacyRoNo: { contains: roText, mode: "insensitive" } },
          ...(numericRo === null ? [] : [{ repairOrderNumber: numericRo }]),
        ],
      },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { id: true, repairOrderNumber: true, legacyRoNo: true, status: true, invoiceDate: true, total: true },
    }),
  ]);
  return { customers, vehicles, repairOrders, invoices };
}
