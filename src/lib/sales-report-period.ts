import { formatReportDateRange, isIsoReportDate } from "./daily-sales-report-model.ts";

export type SalesReportPeriodMode = "daily" | "monthly" | "quarterly" | "yearly";

export type SalesReportPeriodParams = {
  period?: string;
  from?: string;
  to?: string;
  month?: string;
  quarter?: string;
  year?: string;
};

export type SalesReportPeriod = {
  mode: SalesReportPeriodMode;
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
  label: string;
  title: string;
  query: Record<string, string>;
  month?: number;
  quarter?: number;
  year?: number;
};

export type SalesReportPeriodResult =
  | { ok: true; period: SalesReportPeriod }
  | { ok: false; error: string };

const PERIOD_MODES = new Set<SalesReportPeriodMode>(["daily", "monthly", "quarterly", "yearly"]);

function utcDate(year: number, monthIndex: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function parseYear(value: string | undefined) {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 9998 ? year : null;
}

function periodFromExclusiveBounds(
  mode: SalesReportPeriodMode,
  start: Date,
  endExclusive: Date,
  label: string,
  query: Record<string, string>,
  values: { month?: number; quarter?: number; year?: number } = {},
): SalesReportPeriod {
  const from = start.toISOString().slice(0, 10);
  const toDate = new Date(endExclusive);
  toDate.setUTCDate(toDate.getUTCDate() - 1);
  const to = toDate.toISOString().slice(0, 10);
  return { mode, from, to, start, endExclusive, label, title: `Sales Report — ${label}`, query, ...values };
}

export function resolveSalesReportPeriod(
  params: SalesReportPeriodParams,
  defaults: { from: string; to: string },
): SalesReportPeriodResult {
  const requestedMode = params.period ?? "daily";
  if (!PERIOD_MODES.has(requestedMode as SalesReportPeriodMode)) {
    return { ok: false, error: "Choose Daily, Monthly, Quarterly, or Yearly." };
  }
  const mode = requestedMode as SalesReportPeriodMode;

  if (mode === "daily") {
    const from = params.from ?? defaults.from;
    const to = params.to ?? defaults.to;
    if (!isIsoReportDate(from) || !isIsoReportDate(to) || from > to) {
      return { ok: false, error: "Choose valid From and To dates, with To on or after From." };
    }
    const start = new Date(`${from}T00:00:00Z`);
    const endExclusive = new Date(`${to}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    return {
      ok: true,
      period: periodFromExclusiveBounds("daily", start, endExclusive, formatReportDateRange(from, to), { period: "daily", from, to }),
    };
  }

  const year = parseYear(params.year);
  if (year === null) return { ok: false, error: "Choose a valid report year." };

  if (mode === "monthly") {
    const month = Number(params.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, error: "Choose a valid month." };
    }
    const start = utcDate(year, month - 1, 1);
    const endExclusive = utcDate(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);
    const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
    return { ok: true, period: periodFromExclusiveBounds(mode, start, endExclusive, label, { period: mode, month: String(month), year: String(year) }, { month, year }) };
  }

  if (mode === "quarterly") {
    const quarter = Number(params.quarter);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      return { ok: false, error: "Choose Q1, Q2, Q3, or Q4." };
    }
    const startMonth = (quarter - 1) * 3;
    const start = utcDate(year, startMonth, 1);
    const endExclusive = utcDate(quarter === 4 ? year + 1 : year, quarter === 4 ? 0 : startMonth + 3, 1);
    const label = `Q${quarter} ${year}`;
    return { ok: true, period: periodFromExclusiveBounds(mode, start, endExclusive, label, { period: mode, quarter: String(quarter), year: String(year) }, { quarter, year }) };
  }

  const start = utcDate(year, 0, 1);
  const endExclusive = utcDate(year + 1, 0, 1);
  return { ok: true, period: periodFromExclusiveBounds(mode, start, endExclusive, String(year), { period: mode, year: String(year) }, { year }) };
}

export function salesReportPeriodSearch(period: SalesReportPeriod, output?: string) {
  const params = new URLSearchParams(period.query);
  if (output) params.set("output", output);
  return params.toString();
}
