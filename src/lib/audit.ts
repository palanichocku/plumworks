import type { Prisma, ShopMembershipRole } from "@/generated/prisma/client";

export type AuditPolicy =
  | { category: "operational"; enabled: boolean }
  | { category: "governance" };

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

type AuditContext = {
  actorEmail?: string | null;
  actorRole?: ShopMembershipRole | string | null;
  entityLabel?: string | null;
  entityHref?: string | null;
  contextSummary?: string | null;
};

const safeText = (value: string | null | undefined, maximum: number) => value?.trim().slice(0, maximum) || null;

export function auditEntry(
  shopId: string,
  userId: string | undefined,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonObject,
  context: AuditContext = {},
) {
  const href = safeText(context.entityHref, 500);
  return {
    shopId,
    userId: userId ?? null,
    action,
    entityType,
    entityId,
    actorEmail: safeText(context.actorEmail, 320),
    actorRole: safeText(context.actorRole, 32),
    entityLabel: safeText(context.entityLabel, 200),
    entityHref: href?.startsWith("/") ? href : null,
    contextSummary: safeText(context.contextSummary, 500),
    metadata,
  };
}

export async function writeAuditEntry(
  client: AuditClient,
  entry: ReturnType<typeof auditEntry>,
  policy: AuditPolicy,
) {
  if (policy.category === "operational" && !policy.enabled) return null;
  return client.auditLog.create({ data: entry });
}
