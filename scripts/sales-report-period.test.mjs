import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveSalesReportPeriod, salesReportPeriodSearch } from "../src/lib/sales-report-period.ts";

const defaults = { from: "2026-08-01", to: "2026-08-15" };

function period(params) {
  const result = resolveSalesReportPeriod(params, defaults);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.period;
}

function boundaries(params) {
  const value = period(params);
  return [value.start.toISOString().slice(0, 10), value.endExclusive.toISOString().slice(0, 10)];
}

test("daily preserves custom inclusive dates and produces an exclusive next-day boundary", () => {
  const value = period({ from: "2026-01-04", to: "2026-01-09" });
  assert.deepEqual(boundaries({ from: "2026-01-04", to: "2026-01-09" }), ["2026-01-04", "2026-01-10"]);
  assert.equal(value.label, "January 4, 2026 – January 9, 2026");
});

test("monthly boundaries include January and December year rollover", () => {
  assert.deepEqual(boundaries({ period: "monthly", month: "1", year: "2026" }), ["2026-01-01", "2026-02-01"]);
  assert.deepEqual(boundaries({ period: "monthly", month: "12", year: "2025" }), ["2025-12-01", "2026-01-01"]);
  assert.equal(period({ period: "monthly", month: "7", year: "2026" }).title, "Sales Report — July 2026");
});

test("calendar quarter boundaries are exact, including Q4 rollover", () => {
  assert.deepEqual(boundaries({ period: "quarterly", quarter: "1", year: "2026" }), ["2026-01-01", "2026-04-01"]);
  assert.deepEqual(boundaries({ period: "quarterly", quarter: "2", year: "2026" }), ["2026-04-01", "2026-07-01"]);
  assert.deepEqual(boundaries({ period: "quarterly", quarter: "3", year: "2026" }), ["2026-07-01", "2026-10-01"]);
  assert.deepEqual(boundaries({ period: "quarterly", quarter: "4", year: "2026" }), ["2026-10-01", "2027-01-01"]);
  assert.equal(period({ period: "quarterly", quarter: "1", year: "2026" }).title, "Sales Report — Q1 2026");
});

test("yearly boundaries support historical years without a recent-year allowlist", () => {
  assert.deepEqual(boundaries({ period: "yearly", year: "2025" }), ["2025-01-01", "2026-01-01"]);
  assert.deepEqual(boundaries({ period: "yearly", year: "1984" }), ["1984-01-01", "1985-01-01"]);
  assert.equal(period({ period: "yearly", year: "2025" }).title, "Sales Report — 2025");
});

test("invalid modes, dates, ranges, months, quarters, and years fail closed", () => {
  for (const params of [
    { period: "weekly" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-03-02", to: "2026-03-01" },
    { period: "monthly", month: "13", year: "2026" },
    { period: "quarterly", quarter: "5", year: "2026" },
    { period: "yearly", year: "twenty" },
  ]) assert.equal(resolveSalesReportPeriod(params, defaults).ok, false);
});

test("period URL metadata is deterministic and retains print output", () => {
  assert.equal(salesReportPeriodSearch(period({ period: "quarterly", quarter: "1", year: "2026" }), "detail"), "period=quarterly&quarter=1&year=2026&output=detail");
});

test("all modes feed normalized from/to into the one shared report model", async () => {
  const [page, print, query, email] = await Promise.all([
    readFile(new URL("../src/app/(app)/reports/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(app)/reports/print/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/data/daily-sales-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/actions/email-reports.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /resolveSalesReportPeriod/);
  assert.match(page, /getDailySalesReportModel\(\{ from: period\.from, to: period\.to \}\)/);
  assert.match(print, /resolveSalesReportPeriod/);
  assert.match(print, /getDailySalesReportModel\(\{ from, to \}\)/);
  assert.match(email, /resolveSalesReportPeriod/);
  assert.match(email, /getDailySalesReportModel\(\{ from, to \}\)/);
  assert.match(query, /reportableSaleWhere\(shopId, range\)/);
});

test("screen exposes only one selected period control group and carries metadata to print and email", async () => {
  const [filter, controls] = await Promise.all([
    readFile(new URL("../src/components/report-filter-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/daily-sales-report-controls.tsx", import.meta.url), "utf8"),
  ]);
  for (const label of ["Daily", "Monthly", "Quarterly", "Yearly"]) assert.match(filter, new RegExp(`label: "${label}"`));
  assert.match(filter, /mode === "daily"/);
  assert.match(filter, /mode === "monthly"/);
  assert.match(filter, /mode === "quarterly"/);
  assert.match(controls, /salesReportPeriodSearch\(period, view\)/);
  assert.match(controls, /<EmailPdfForm period=\{period\}/);
});
