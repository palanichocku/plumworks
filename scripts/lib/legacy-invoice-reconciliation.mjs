export function textValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const value = rawData[field];
  return typeof value === "string" ? value.trim() || null : null;
}

export function parseLegacyDate(rawValue) {
  if (!rawValue || !/^\d{8}$/.test(rawValue)) return null;
  const year = Number(rawValue.slice(0, 4));
  const month = Number(rawValue.slice(4, 6));
  const day = Number(rawValue.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

export function groupRowsByRo(rows) {
  const groups = new Map();
  for (const row of rows) {
    const ro = row.legacyRoNo?.trim();
    if (!ro) continue;
    const group = groups.get(ro) ?? [];
    group.push(row);
    groups.set(ro, group);
  }
  return groups;
}

function validDates(rows, field, source) {
  const dates = [];
  const invalid = [];
  for (const row of rows) {
    const raw = textValue(row.rawData, field);
    if (!raw) continue;
    const value = parseLegacyDate(raw);
    if (value) dates.push({ source, raw, value });
    else invalid.push({ source, raw });
  }
  return { dates, invalid };
}

export function selectLegacyInvoiceDate({ arRows = [], finalRows = [], laborRows = [] }) {
  const arSold = validDates(arRows, "DATE_SOLD", "AR.DATE_SOLD");
  const arHeader = validDates(arRows, "RO_DATE", "AR.RO_DATE");
  const finalSold = validDates(finalRows, "DATE_SOLD", "FINAL.DATE_SOLD");
  const laborSold = validDates(laborRows, "DATE_SOLD", "laborfinal.DATE_SOLD");
  const finalOpened = validDates(finalRows, "RO_DATE", "FINAL.RO_DATE");
  const precedence = [arSold, arHeader, finalSold, laborSold, finalOpened];
  const selected = precedence.find((candidate) => candidate.dates.length)?.dates[0] ?? null;
  const completedDates = [...arSold.dates, ...finalSold.dates, ...laborSold.dates];
  const fallbackDates = [...arHeader.dates, ...finalSold.dates, ...laborSold.dates, ...finalOpened.dates];
  const conflicts = selected?.source === "AR.DATE_SOLD"
    ? fallbackDates.filter((candidate) => candidate.raw !== selected.raw)
    : [];
  return {
    date: selected?.value ?? null,
    source: selected?.source ?? null,
    missingCompletedDate: completedDates.length === 0,
    invalidDates: precedence.flatMap((candidate) => candidate.invalid),
    conflicts,
  };
}
