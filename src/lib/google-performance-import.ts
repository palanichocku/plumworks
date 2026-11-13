import "server-only";

import { inflateRawSync } from "node:zlib";

export type ParsedGoogleSnapshot = {
  source: "GBP" | "GSC";
  periodStart: string;
  periodEnd: string;
  partial: boolean;
  metrics: Record<string, number>;
  notes: string;
};
export type ParsedGoogleReport = { source: "GBP" | "GSC"; snapshots: ParsedGoogleSnapshot[]; warnings: string[]; businessName?: string };

function csvRows(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Malformed CSV: unfinished quoted value.");
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
function exactDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Invalid report date.");
  const parsed = new Date(raw + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error("Invalid report date.");
  return raw;
}
function wholeMonth(start: string, end: string): boolean {
  const s = exactDate(start), e = exactDate(end);
  const d = new Date(e + "T00:00:00.000Z");
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return s.endsWith("-01") && monthEnd === e && s.slice(0, 7) === e.slice(0, 7);
}
function nonnegative(raw: string, name: string): number {
  const n = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new Error("Invalid " + name + " metric.");
  return n;
}
function headerMap(row: string[]) { return new Map(row.map((field, i) => [field.trim().toLowerCase(), i])); }
function requireCell(header: Map<string, number>, row: string[], key: string) {
  const idx = header.get(key.toLowerCase());
  if (idx === undefined) throw new Error("Required CSV column missing: " + key);
  return row[idx] ?? "";
}
function dateRangeFromFileName(fileName: string): [string, string] {
  const matches = /(?:^| - )(\d{4})-(\d{1,2})-(\d{1,2}) - (\d{4})-(\d{1,2})-(\d{1,2})(?: - |\.csv$)/i.exec(fileName);
  if (!matches) throw new Error("Business Profile export filename must contain the original start and end dates. Keep the original Google filename.");
  const toDate = (y: string, m: string, d: string) => exactDate(y + "-" + m.padStart(2, "0") + "-" + d.padStart(2, "0"));
  return [toDate(matches[1], matches[2], matches[3]), toDate(matches[4], matches[5], matches[6])];
}
function parseBusinessProfile(fileName: string, text: string): ParsedGoogleReport {
  const rows = csvRows(text);
  if (rows.length < 3 || rows.length > 4) throw new Error("Business Profile report must contain one business data row.");
  const header = headerMap(rows[0]), raw = rows[2];
  for (const k of ["Business name", "Google Search - Mobile", "Google Search - Desktop", "Google Maps - Mobile", "Google Maps - Desktop", "Calls", "Directions", "Website clicks"]) {
    requireCell(header, raw, k);
  }
  const businessName = requireCell(header, raw, "Business name").trim();
  if (!businessName) throw new Error("Missing business identity.");
  const [start, end] = dateRangeFromFileName(fileName);
  if (start > end || end > new Date().toISOString().slice(0, 10)) throw new Error("Report dates are invalid or in the future.");
  const value = (name: string) => nonnegative(requireCell(header, raw, name), name);
  const metrics: Record<string, number> = {
    searchMobileViews: value("Google Search - Mobile"),
    searchDesktopViews: value("Google Search - Desktop"),
    mapsMobileViews: value("Google Maps - Mobile"),
    mapsDesktopViews: value("Google Maps - Desktop"),
    calls: value("Calls"),
    directions: value("Directions"),
    websiteClicks: value("Website clicks"),
  };
  metrics.views = metrics.searchMobileViews + metrics.searchDesktopViews + metrics.mapsMobileViews + metrics.mapsDesktopViews;
  metrics.interactions = metrics.calls + metrics.directions + metrics.websiteClicks;
  for (const key of ["Bookings", "Messages"]) {
    const idx = header.get(key.toLowerCase());
    if (idx !== undefined && (raw[idx] ?? "").trim()) metrics[key.toLowerCase()] = nonnegative(raw[idx], key);
  }
  return {
    source: "GBP", businessName,
    snapshots: [{ source: "GBP", periodStart: start, periodEnd: end, partial: !wholeMonth(start, end), metrics,
      notes: "Uploaded Google Business Profile CSV · " + fileName.slice(0, 160) }],
    warnings: wholeMonth(start, end) ? [] : ["This covers a partial or multiple-month period. It will not count as a complete-month trend."],
  };
}

// Extract bounded ZIP entries from the central directory. Reject encryption, ZIP64,
// nested paths, zip bombs, and unsupported compression rather than trusting filenames.
function readZip(buffer: Buffer): Map<string, string> {
  if (buffer.length < 22) throw new Error("Not a valid ZIP export.");
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP directory not found.");
  const count = buffer.readUInt16LE(eocd + 10), directory = buffer.readUInt32LE(eocd + 16);
  if (count > 20 || count === 65535 || directory >= buffer.length) throw new Error("Unexpected ZIP directory.");
  const files = new Map<string, string>();
  let pos = directory;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Invalid ZIP entry.");
    const flags = buffer.readUInt16LE(pos + 8), method = buffer.readUInt16LE(pos + 10);
    const compressed = buffer.readUInt32LE(pos + 20), plain = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28), extra = buffer.readUInt16LE(pos + 30), comment = buffer.readUInt16LE(pos + 32);
    const offset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extra + comment;
    if (/[/\\]/.test(name) || name.includes("..") || !name.toLowerCase().endsWith(".csv")) throw new Error("ZIP must contain flat CSV files only.");
    if ((flags & 1) || ![0,8].includes(method) || plain > 2_000_000 || compressed > 2_000_000 || offset + 30 > buffer.length) throw new Error("Unsupported or oversized ZIP entry.");
    if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("Invalid ZIP payload.");
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    if (dataStart + compressed > buffer.length) throw new Error("Truncated ZIP payload.");
    const data = buffer.subarray(dataStart, dataStart + compressed);
    const output = method === 8 ? inflateRawSync(data, { maxOutputLength: 2_000_001 }) : data;
    if (output.length !== plain) throw new Error("ZIP size mismatch.");
    if (files.has(name.toLowerCase())) throw new Error("Duplicate CSV in ZIP.");
    files.set(name.toLowerCase(), output.toString("utf8"));
  }
  return files;
}
function parseSearchConsole(chart: string, zipped: boolean): ParsedGoogleReport {
  const rows = csvRows(chart);
  if (rows.length < 2 || rows.length > 600) throw new Error("Search Console daily chart is empty or too large.");
  const header = headerMap(rows[0]);
  const daily = new Map<string, { clicks: number; impressions: number; weightedPosition: number }>();
  for (const row of rows.slice(1)) {
    const day = exactDate(requireCell(header, row, "Date").trim());
    const clicks = nonnegative(requireCell(header, row, "Clicks"), "Clicks");
    const impressions = nonnegative(requireCell(header, row, "Impressions"), "Impressions");
    const position = nonnegative(requireCell(header, row, "Position"), "Position");
    if (!Number.isInteger(clicks) || !Number.isInteger(impressions) || daily.has(day)) throw new Error("Duplicate or invalid daily Search Console row.");
    daily.set(day, { clicks, impressions, weightedPosition: impressions * position });
  }
  const dates = [...daily.keys()].sort();
  const grouped = new Map<string, string[]>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), date]);
  }
  const snapshots: ParsedGoogleSnapshot[] = [];
  for (const [month, days] of grouped) {
    const start = days[0], end = days[days.length - 1];
    const clicks = days.reduce((n, day) => n + daily.get(day)!.clicks, 0);
    const impressions = days.reduce((n, day) => n + daily.get(day)!.impressions, 0);
    const weightedPosition = days.reduce((n, day) => n + daily.get(day)!.weightedPosition, 0);
    const metrics: Record<string, number> = { clicks, impressions, ctr: impressions ? Math.round(10000 * clicks / impressions) / 100 : 0 };
    if (impressions) metrics.averagePosition = Math.round(weightedPosition / impressions * 100) / 100;
    const missingDays = (new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86400000 + 1 !== days.length;
    snapshots.push({ source: "GSC", periodStart: start, periodEnd: end, partial: !wholeMonth(start, end) || missingDays, metrics,
      notes: "Uploaded Search Console daily Chart.csv" + (zipped ? " from Google export ZIP." : ".") + " CTR derived from totals; average position weighted by impressions from rounded daily values." });
  }
  return { source: "GSC", snapshots, warnings: [
    "Search Console export does not authenticate the property domain. Confirm this is Car Doc's property before saving.",
    ...(snapshots.some((s) => s.partial) ? ["Incomplete months are stored as partial and excluded from monthly trend comparisons."] : []),
  ] };
}
export function parseGooglePerformanceFile(fileName: string, buffer: Buffer): ParsedGoogleReport {
  if (buffer.length === 0 || buffer.length > 3_000_000) throw new Error("File must be under 3 MB.");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    const files = readZip(buffer);
    const chart = files.get("chart.csv");
    if (!chart) throw new Error("Search Console ZIP must contain Chart.csv.");
    if (!files.has("filters.csv") || !files.has("queries.csv")) throw new Error("Use the complete Search Console ZIP export.");
    return parseSearchConsole(chart, true);
  }
  if (!lower.endsWith(".csv")) throw new Error("Only Google CSV or Search Console ZIP exports are supported.");
  const text = buffer.toString("utf8");
  const first = csvRows(text)[0] ?? [];
  const headers = headerMap(first);
  if (headers.has("store code") && headers.has("google search - mobile")) return parseBusinessProfile(fileName, text);
  if (headers.has("date") && headers.has("clicks") && headers.has("impressions")) return parseSearchConsole(text, false);
  throw new Error("Unrecognized report. Upload the original Google Business Profile CSV or Search Console Chart.csv / ZIP.");
}
