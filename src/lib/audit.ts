import type { Prisma } from "@/generated/prisma/client";

export function auditEntry(
  shopId: string,
  userId: string | undefined,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonObject,
) {
  return {
    shopId,
    userId: userId ?? null,
    action,
    entityType,
    entityId,
    metadata,
  };
}
