import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyNewMarketingLead } from "@/lib/marketing-lead-notifications";

export async function storeMarketingLead(data: Prisma.MarketingLeadUncheckedCreateInput) {
  const lead = await prisma.$transaction(async (transaction) => {
    const shop = await transaction.shop.findUniqueOrThrow({
      where: { id: data.shopId }, select: { marketingLeadInAppNotificationsEnabled: true },
    });
    const created = await transaction.marketingLead.create({ data });
    if (shop.marketingLeadInAppNotificationsEnabled) {
      await transaction.marketingLeadNotification.create({
        data: { shopId: created.shopId, marketingLeadId: created.id },
      });
    }
    return created;
  });
  // The committed lead is authoritative, even if settings lookup or delivery fails.
  try { await notifyNewMarketingLead(lead); }
  catch { console.error("Marketing lead email notification failed"); }
  return lead;
}
