"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import {
  HISTORICAL_DESCRIPTION_MIN_CHARS,
  HISTORICAL_DESCRIPTION_SOURCE_LIMIT,
  normalizeHistoricalDescription,
  rankHistoricalDescriptions,
  type HistoricalDescriptionKind,
  type HistoricalDescriptionSuggestion,
} from "@/lib/historical-descriptions";

export async function searchHistoricalDescriptions(kind: HistoricalDescriptionKind, value: string): Promise<HistoricalDescriptionSuggestion[]> {
  const query = normalizeHistoricalDescription(value);
  if (query.length < HISTORICAL_DESCRIPTION_MIN_CHARS) return [];
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) throw new Error("Authentication required");
  const words = query.split(" ");
  const descriptionWhere = { AND: words.map((word) => ({ description: { contains: word, mode: "insensitive" as const } })) };
  const select = { description: true, updatedAt: true } as const;
  const orderBy = { updatedAt: "desc" as const };
  const take = HISTORICAL_DESCRIPTION_SOURCE_LIMIT;

  const sources = kind === "part"
    ? await Promise.all([
        prisma.invoicePart.findMany({ where: { shopId: membership.shopId, ...descriptionWhere }, select, orderBy, take }),
        prisma.repairOrderPart.findMany({ where: { shopId: membership.shopId, ...descriptionWhere }, select, orderBy, take }),
      ])
    : await Promise.all([
        prisma.invoiceLabor.findMany({ where: { shopId: membership.shopId, complimentary: kind === "complimentary-labor", ...descriptionWhere }, select, orderBy, take }),
        prisma.repairOrderLabor.findMany({ where: { shopId: membership.shopId, complimentary: kind === "complimentary-labor", ...descriptionWhere }, select, orderBy, take }),
      ]);

  return rankHistoricalDescriptions(sources.flat().map((row) => ({ description: row.description, usedAt: row.updatedAt })), query);
}
