import "server-only";

import { prisma } from "@/lib/prisma";
import { loadDailySalesReport } from "./daily-sales-query";
import { getCurrentMembership } from "./membership";
import { inclusiveUtcDateRange } from "../daily-sales-aggregation";

export type ReportDateRange = {
  start: Date;
  endExclusive: Date;
};

export async function getShopReport(range: ReportDateRange) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;

  return getShopReportForShop(membership.shopId, range);
}

export async function getShopReportForShop(shopId: string, range: ReportDateRange) {
  return loadDailySalesReport(prisma, shopId, range);
}

export type DailySalesReportModel = NonNullable<Awaited<ReturnType<typeof getDailySalesReportModel>>>;

export async function getDailySalesReportModel({
  from,
  to,
  generatedAt = new Date(),
}: {
  from: string;
  to: string;
  generatedAt?: Date;
}) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  const range = inclusiveUtcDateRange(from, to);
  const [shop, report] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: membership.shopId },
      select: {
        id: true,
        name: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
      },
    }),
    getShopReportForShop(membership.shopId, range),
  ]);
  if (!shop) return null;
  return { shop, from, to, generatedAt, range, ...report };
}
