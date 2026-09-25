import type { MarketingLeadStatus, Prisma } from "@/generated/prisma/client";
import { callClickMessage } from "@/lib/marketing-lead-context";

// Call-click analytics stay stored but are not operational customer leads.
// Explicitly include null messages: SQL NOT(message = marker) excludes NULL.
export function operationalMarketingLeadWhere(shopId: string, status?: MarketingLeadStatus): Prisma.MarketingLeadWhereInput {
  return {
    shopId,
    ...(status ? { status } : {}),
    OR: [
      { source: { not: "CONTACT" } },
      { message: null },
      { message: { not: callClickMessage } },
    ],
  };
}
