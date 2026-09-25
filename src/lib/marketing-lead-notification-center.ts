import "server-only";
import { operationalMarketingLeadWhere } from "@/lib/marketing-lead-query";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentMembership } from "@/lib/data/membership";

export async function requireLeadMembership() {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) throw new Error("Sign in with an active shop membership.");
  return { shopId: membership.shopId, userId: user.id, role: membership.role };
}

export async function getLeadNotificationState() {
  const { shopId, userId } = await requireLeadMembership();
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId }, select: { marketingLeadInAppNotificationsEnabled: true },
  });
  const asOf = new Date();
  if (!shop.marketingLeadInAppNotificationsEnabled) return { enabled: false, unreadCount: 0, items: [], asOf: asOf.toISOString() };
  const [notifications, unreadCount] = await prisma.$transaction([
    prisma.marketingLeadNotification.findMany({
      where: { shopId, createdAt: { lte: asOf } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
      select: {
        id: true, createdAt: true,
        marketingLead: { select: { id: true, name: true, source: true, status: true, vehicleYear: true, vehicleMake: true, vehicleModel: true } },
        reads: { where: { shopId, userId }, select: { readAt: true } },
      },
    }),
    prisma.marketingLeadNotification.count({ where: { shopId, createdAt: { lte: asOf }, reads: { none: { shopId, userId } } } }),
  ]);
  return {
    enabled: true, unreadCount, asOf: asOf.toISOString(),
    items: notifications.map(({ id, createdAt, marketingLead: lead, reads }) => ({
      id, createdAt: createdAt.toISOString(), read: reads.length > 0,
      leadId: lead.id, name: lead.name, source: lead.source, status: lead.status,
      vehicle: [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" "),
    })),
  };
}

export async function readLeadNotification(id: string) {
  const { shopId, userId } = await requireLeadMembership();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Notification not found.");
  return prisma.$transaction(async (transaction) => {
    const notification = await transaction.marketingLeadNotification.findFirst({ where: { id, shopId }, select: { id: true, marketingLeadId: true } });
    if (!notification) throw new Error("Notification not found.");
    await transaction.marketingLeadNotificationRead.createMany({
      data: [{ shopId, userId, notificationId: notification.id }], skipDuplicates: true,
    });
    return { href: `/leads/${notification.marketingLeadId}` };
  });
}

export async function readAllLeadNotifications(asOf: string) {
  const { shopId, userId } = await requireLeadMembership();
  const cutoff = new Date(asOf);
  if (!Number.isFinite(cutoff.getTime()) || cutoff > new Date()) throw new Error("Invalid notification timestamp.");
  await prisma.$transaction(async (transaction) => {
    const notifications = await transaction.marketingLeadNotification.findMany({
      where: { shopId, createdAt: { lte: cutoff }, reads: { none: { shopId, userId } } }, select: { id: true },
    });
    if (notifications.length) await transaction.marketingLeadNotificationRead.createMany({
      data: notifications.map(({ id }) => ({ shopId, userId, notificationId: id })), skipDuplicates: true,
    });
  });
}

export async function getOperationalLead(id: string) {
  const { shopId, userId, role } = await requireLeadMembership();
  if (!hasPermission(role, "view_marketing_leads")) throw new Error("You do not have permission to view leads.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { lead: null, role };
  const lead = await prisma.marketingLead.findFirst({
    where: { ...operationalMarketingLeadWhere(shopId), id },
    include: { notification: { include: { reads: { where: { shopId, userId }, select: { readAt: true } } } } },
  });
  return { lead, role };
}
