export const HISTORICAL_DESCRIPTION_MIN_CHARS = 2;
export const HISTORICAL_DESCRIPTION_LIMIT = 9;
export const HISTORICAL_DESCRIPTION_SOURCE_LIMIT = 50;

export type HistoricalDescriptionKind = "part" | "labor" | "complimentary-labor";
export type HistoricalDescriptionCandidate = { description: string; usedAt: Date };
export type HistoricalDescriptionSuggestion = { description: string };

export function normalizeHistoricalDescription(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function matchRank(description: string, query: string) {
  if (description === query) return 0;
  if (description.startsWith(query)) return 1;
  if (description.split(" ").some((word) => word.startsWith(query))) return 2;
  return 3;
}

export function rankHistoricalDescriptions(
  candidates: HistoricalDescriptionCandidate[],
  value: string,
  limit = HISTORICAL_DESCRIPTION_LIMIT,
): HistoricalDescriptionSuggestion[] {
  const query = normalizeHistoricalDescription(value);
  if (query.length < HISTORICAL_DESCRIPTION_MIN_CHARS) return [];

  const grouped = new Map<string, { description: string; count: number; usedAt: Date }>();
  for (const candidate of candidates) {
    const normalized = normalizeHistoricalDescription(candidate.description);
    if (!normalized || !normalized.includes(query)) continue;
    const current = grouped.get(normalized);
    if (!current) grouped.set(normalized, { description: candidate.description.trim().replace(/\s+/g, " "), count: 1, usedAt: candidate.usedAt });
    else {
      current.count += 1;
      if (candidate.usedAt > current.usedAt || (candidate.usedAt.getTime() === current.usedAt.getTime() && candidate.description.localeCompare(current.description) < 0)) {
        current.description = candidate.description.trim().replace(/\s+/g, " ");
        current.usedAt = candidate.usedAt;
      }
    }
  }

  return [...grouped.entries()]
    .sort(([aKey, a], [bKey, b]) => matchRank(aKey, query) - matchRank(bKey, query) || b.count - a.count || b.usedAt.getTime() - a.usedAt.getTime() || a.description.localeCompare(b.description))
    .slice(0, limit)
    .map(([, candidate]) => ({ description: candidate.description }));
}
