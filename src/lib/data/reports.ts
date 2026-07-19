import "server-only";

import { prisma } from "@/lib/prisma";
import { loadDailySalesReport } from "./daily-sales-query";
import { getCurrentMembership } from "./membership";

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
