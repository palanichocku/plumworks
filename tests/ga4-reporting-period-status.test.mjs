import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("src/lib/ga4-visitor-report.ts", "utf8");
const panel = readFileSync("src/app/(app)/dashboard/website-performance/ga4-visitor-panel.tsx", "utf8");

// Exercise the actual range helper without loading server-only dependencies.
const start = source.indexOf("export function ga4ReportingRange(");
const end = source.indexOf("\nfunction parseCount(", start);
assert.ok(start !== -1 && end > start, "reporting range helper must exist");
const helper = source.slice(start, end).replace("export function ", "function ")
  .replace("now = new Date()", "now")
  .replace(": { month: string; start: string; end: string; partial: boolean }", "");
const ga4ReportingRange = runInNewContext(helper + "\nga4ReportingRange;", { Date, Intl, Object });

test("during initial November: month-to-date uses Detroit date and partial flag", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ga4ReportingRange(new Date("2026-11-14T01:30:00Z")))), {
    month: "2026-11", start: "2026-11-01", end: "2026-11-13", partial: true,
  });
});

test("from December: November becomes last complete calendar month", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ga4ReportingRange(new Date("2026-12-01T16:00:00Z")))), {
    month: "2026-11", start: "2026-11-01", end: "2026-11-30", partial: false,
  });
});

test("reporting states distinguish no data and failed connection", () => {
  assert.match(source, /"no_data"/);
  assert.match(source, /"connection_error"/);
  assert.match(source, /state: row \? "available" : "no_data"/);
  assert.match(panel, /Month to date \(partial\)/);
  assert.match(panel, /Unable to retrieve Google Analytics data/);
  assert.match(panel, /No visitor activity recorded for this reporting period/);
  assert.doesNotMatch(panel, /Owner setup:/);
});
