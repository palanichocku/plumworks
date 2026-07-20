export const DAILY_SALES_COLUMNS = [
  "Date",
  "RO / Invoice",
  "Customer",
  "Vehicle",
  "Total",
  "Parts",
  "Labor",
  "Shop Supplies",
  "Sales Tax",
  "Cash",
  "Check",
  "Card",
  "Internal",
] as const;

export const REPORT_TIME_ZONE = "America/Detroit";
export type DailySalesReportOutput = "summary" | "detail";

export function normalizeDailySalesReportOutput(value: string | null | undefined): DailySalesReportOutput {
  return value === "summary" ? "summary" : "detail";
}

export function dailySalesReportTitle(output: DailySalesReportOutput) {
  return output === "summary" ? "Daily Sales Summary" : "Daily Sales Report";
}

export function canEmailDailySalesReport(role: string | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function dailySalesReportFilename(from: string, to: string, output: DailySalesReportOutput = "detail") {
  const stem = output === "summary" ? "daily-sales-summary" : "daily-sales-report";
  return from === to ? `${stem}-${from}.pdf` : `${stem}-${from}-to-${to}.pdf`;
}

export function isIsoReportDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isValidReportRange(from: string | undefined, to: string | undefined) {
  return isIsoReportDate(from) && isIsoReportDate(to) && from <= to;
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatReportDateRange(from: string, to: string) {
  const start = formatCalendarDate(from);
  return from === to ? start : `${start} – ${formatCalendarDate(to)}`;
}

export function formatReportGeneratedAt(value: Date, timeZone = REPORT_TIME_ZONE) {
  return `Generated ${new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value).replace(", at", " at")}`;
}

export function formatReportGeneratedTime(value: Date, timeZone = REPORT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(value);
}
