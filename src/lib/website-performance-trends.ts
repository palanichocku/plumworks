export const REPORTING_FIRST_MONTH = "2026-10";
export type MarketingSource = "GBP" | "GSC";
export type MonthlySnapshot = { id: string; source: string; periodStart: string; periodEnd: string; partial: boolean; metrics: Record<string, unknown>; recordedAt: string };
export type Metric = { source: MarketingSource; key: string; label: string; subtitle: string; unit?: string; decimals?: number; lowerIsBetter?: boolean };
export const METRICS: Metric[] = [
  { source: "GSC", key: "clicks", label: "Clicks from Google Search", subtitle: "Organic search clicks" },
  { source: "GSC", key: "impressions", label: "Appearances in Google", subtitle: "Search impressions" },
  { source: "GSC", key: "ctr", label: "Search click rate", subtitle: "Click-through rate (CTR)", unit: "%", decimals: 1 },
  { source: "GSC", key: "averagePosition", label: "Average search ranking", subtitle: "Search position · Lower is better", decimals: 1, lowerIsBetter: true },
  { source: "GBP", key: "views", label: "Business listing views", subtitle: "Google Business Profile views" },
  { source: "GBP", key: "calls", label: "Call button taps", subtitle: "Google call interactions" },
  { source: "GBP", key: "directions", label: "Direction requests", subtitle: "Google Maps directions" },
  { source: "GBP", key: "websiteClicks", label: "Website link clicks", subtitle: "Google Business Profile link" },
];
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
export function monthBeforeYear(month: string): string {
  return String(Number(month.slice(0, 4)) - 1) + month.slice(4);
}
function endOfMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}
export function completeMonth(row: MonthlySnapshot): boolean {
  const month = row.periodStart.slice(0, 7);
  return !row.partial && month >= REPORTING_FIRST_MONTH &&
    row.periodStart === month + "-01" && row.periodEnd === endOfMonth(month);
}
// Unique complete calendar month for each source. Ignore incomplete, overlapping and
// ambiguous duplicate source/month records rather than silently double counting.
export function monthlyIndex(rows: MonthlySnapshot[]): Map<string, MonthlySnapshot> {
  const grouped = new Map<string, MonthlySnapshot[]>();
  for (const row of rows) {
    if (!completeMonth(row) || !["GBP", "GSC"].includes(row.source)) continue;
    const key = row.source + ":" + row.periodStart.slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const result = new Map<string, MonthlySnapshot>();
  for (const [key, candidates] of grouped) {
    // Exact period duplicates use the latest imported record. Conflicting
    // complete-month bounds are not possible once completeMonth() passes.
    candidates.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));
    result.set(key, candidates[0]);
  }
  return result;
}
export function metricValue(index: Map<string, MonthlySnapshot>, metric: Metric, month: string): number | null {
  const raw = index.get(metric.source + ":" + month)?.metrics[metric.key];
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}
export function changePercent(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous === 0 ? null : (current - previous) / previous * 100;
}
export function availableMonths(index: Map<string, MonthlySnapshot>): string[] {
  return [...new Set([...index.keys()].map((k) => k.slice(4)))].sort();
}
export function lastTwelveMonths(selected: string): string[] {
  const months: string[] = [];
  let month = selected;
  for (let i = 0; i < 12 && month >= REPORTING_FIRST_MONTH; i++) {
    months.unshift(month);
    month = previousMonth(month);
  }
  return months;
}
export function annualMetric(index: Map<string, MonthlySnapshot>, metric: Metric, year: number): number | null {
  if (year < 2027) return null; // 2026 reporting begins in October, not January.
  const months = Array.from({ length: 12 }, (_, i) => year + "-" + String(i + 1).padStart(2, "0"));
  const values = months.map((month) => metricValue(index, metric, month));
  if (values.some((v) => v === null)) return null;
  // CTR and position are ratios/averages, not additive annual values. Report
  // only additive metrics until an authoritative weighted annual source exists.
  if (metric.key === "ctr" || metric.key === "averagePosition") return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}
// Plain-language explanations for the owner, also used in clickable chart help.
export function metricExplanation(metric: Metric): string {
  const descriptions: Record<string, string> = {
    "GSC:clicks": "How many times people clicked a Car Doc result in Google Search to visit the website. One person may click more than once.",
    "GSC:impressions": "How often Car Doc pages appeared in Google Search results. An appearance is not a website visit.",
    "GSC:ctr": "The percentage of Google Search appearances that resulted in a click. Higher usually means more searchers chose our listing.",
    "GSC:averagePosition": "The average Google Search result position across the searches where Car Doc appeared. Smaller numbers generally mean a higher position, but it is not a ranking for one specific keyword.",
    "GBP:views": "The number of times people viewed the Car Doc Google Business Profile in Google Search or Maps. These are views of the listing, not confirmed website visits.",
    "GBP:calls": "How many times someone tapped the call button on Car Doc's Google Business Profile. These are not verified phone conversations or answered calls.",
    "GBP:directions": "How many times people requested directions to Car Doc using its Google Business Profile. It does not prove they visited the shop.",
    "GBP:websiteClicks": "How many times someone clicked the website link on Car Doc's Google Business Profile. It does not count every visit to the website.",
  };
  return descriptions[metric.source + ":" + metric.key] ??
    "This is a measurement imported from Google for the selected reporting month.";
}
export function formatReportingMonth(month: string, short = false): string {
  const [year, number] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, number - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" }).format(value);
}
export function displayMetric(value: number | null, metric: Metric): string {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: metric.decimals ?? 0 }) + (metric.unit ?? "");
}
