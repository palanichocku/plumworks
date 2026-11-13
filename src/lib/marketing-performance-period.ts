const zone = "America/Detroit";
function parts(date: Date) {
  const items = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric" }).formatToParts(date);
  return { year: Number(items.find((item) => item.type === "year")?.value), month: Number(items.find((item) => item.type === "month")?.value) };
}
function localMidnightUtc(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 1, 2, 12));
  const zoneLabel = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(date).find((item) => item.type === "timeZoneName")?.value ?? "GMT-5";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zoneLabel);
  if (!match) throw new Error("Cannot resolve Michigan timezone offset.");
  const minutes = (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === "+" ? 1 : -1);
  return new Date(Date.UTC(year, month - 1, 1) - minutes * 60_000);
}
export function detroitMonthRange(now = new Date()) {
  const { year, month } = parts(now);
  return { start: localMidnightUtc(year, month), endExclusive: localMidnightUtc(year, month + 1) };
}
