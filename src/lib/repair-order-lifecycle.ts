import type { Prisma } from "@/generated/prisma/client";

export function operationalRepairOrderWhere(shopId: string): Prisma.RepairOrderWhereInput {
  return {
    shopId,
    status: { in: ["draft", "open"] },
    legacySourceTable: null,
    invoices: { none: {} },
  };
}
