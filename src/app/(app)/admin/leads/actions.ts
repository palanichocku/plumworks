"use server";

import { revalidatePath } from "next/cache";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { notifyScheduledMarketingLead } from "@/lib/marketing-lead-notifications";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const statuses = new Set(Object.values(MarketingLeadStatus));

export async function updateLeadStatus(formData: FormData) {
  const { membership } = await requirePermission("edit_shop_settings");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as MarketingLeadStatus;
  const rawDate = String(formData.get("scheduledDate") ?? "").trim();
  const scheduledTime = String(formData.get("scheduledTime") ?? "").trim().slice(0, 5) || null;
  const internalNote = String(formData.get("internalNote") ?? "").trim().slice(0, 3000) || null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !statuses.has(status)) throw new Error("Invalid lead update.");
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new Error("Invalid scheduled date.");
  if (scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw new Error("Invalid scheduled time.");
  if (status === "SCHEDULED" && (!rawDate || !scheduledTime)) throw new Error("Scheduled date and time are required.");
  const scheduledDate = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : null;

  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.marketingLead.updateMany({
      where: { id, shopId: membership.shopId },
      data: { status, scheduledDate, scheduledTime, internalNote },
    });
    if (result.count !== 1) throw new Error("Lead was not found.");
    return transaction.marketingLead.findFirstOrThrow({ where: { id, shopId: membership.shopId } });
  });
  if (status === "SCHEDULED") await notifyScheduledMarketingLead(updated);
  revalidatePath("/admin/leads");
  revalidatePath("/dashboard");
}
