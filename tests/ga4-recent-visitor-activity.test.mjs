import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const lib = readFileSync("src/lib/ga4-visitor-report.ts", "utf8");
const page = readFileSync("src/app/(app)/dashboard/website-performance/page.tsx", "utf8");
const recentPanel = readFileSync("src/app/(app)/dashboard/website-performance/ga4-recent-visitors-panel.tsx", "utf8");

test("recent GA4 categories have separate live and processed API routes", () => {
  assert.match(lib, /:runRealtimeReport/);
  assert.match(lib, /:runReport/);
  assert.match(lib, /dateHour/);
  assert.match(lib, /Promise\.allSettled/);
  assert.match(recentPanel, /Live · Last 30 minutes/);
  assert.match(recentPanel, /Past 24 hourly buckets · Processed/);
  assert.match(recentPanel, /not an exact minute-by-minute rolling period/);
  assert.ok(page.indexOf("<Ga4RecentVisitorsPanel />") < page.indexOf("<Ga4VisitorPanel />"));
});

test("24 hourly buckets include current and 23 preceding hours in Detroit", () => {
  const start = lib.indexOf("function detroitHour(");
  const end = lib.indexOf("\nasync function hourlyReport(", start);
  assert.ok(start > 0 && end > start);
  const extracted = lib.slice(start, end)
    .replace("function detroitHour(date: Date): string", "function detroitHour(date)")
    .replace("export function recentHourlyWindow(now = new Date())", "function recentHourlyWindow(now)");
  const window = runInNewContext(extracted + "\nrecentHourlyWindow(new Date('2026-11-13T20:30:00Z'))", { Date, Intl, Object });
  assert.deepEqual(JSON.parse(JSON.stringify(window)), { first: "2026111216", last: "2026111315" });
});
