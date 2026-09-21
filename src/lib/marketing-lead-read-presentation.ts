import type { MarketingLead } from "@/generated/prisma/client";

export function leadReadNotification(lead: MarketingLead & { notification: { id: string; reads: { readAt: Date }[] } | null }) {
  return lead.notification ? {
    id: lead.notification.id, leadId: lead.id, read: lead.notification.reads.length > 0,
  } : null;
}
