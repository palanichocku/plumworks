import test from "node:test";
import assert from "node:assert/strict";
import {
  METRICS, completeMonth, monthlyIndex, metricValue, changePercent,
  annualMetric, availableMonths, lastTwelveMonths, previousMonth,
} from "../src/lib/website-performance-trends.ts";

const clicks = METRICS.find((metric) => metric.source === "GSC" && metric.key === "clicks");
const ctr = METRICS.find((metric) => metric.key === "ctr");
const record = (month, metrics, overrides = {}) => {
  const [year, mm] = month.split("-").map(Number);
  return { id: month, source: "GSC", periodStart: month + "-01",
    periodEnd: new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10),
    partial: false, metrics, recordedAt: month + "-28T00:00:00Z", ...overrides };
};

test("October 2026 is first month; earlier months and partial November are excluded", () => {
  const rows = [record("2026-09", { clicks: 7 }),record("2026-10", { clicks: 15 }),
    record("2026-11", { clicks: 2 }, { partial: true, periodEnd: "2026-11-10" })];
  const index = monthlyIndex(rows);
  assert.deepEqual(availableMonths(index), ["2026-10"]);
  assert.equal(metricValue(index, clicks, "2026-10"), 15);
  assert.equal(metricValue(index, clicks, "2026-11"), null);
  assert.equal(completeMonth(rows[2]), false);
});
test("unknown stays unknown; recorded zero stays zero; no percent from zero baseline", () => {
  const index = monthlyIndex([record("2026-10", { clicks: 0 }),record("2026-11", { impressions: 42 })]);
  assert.equal(metricValue(index, clicks, "2026-10"), 0);
  assert.equal(metricValue(index, clicks, "2026-11"), null);
  assert.equal(changePercent(10, 0), null);
  assert.equal(changePercent(15, null), null);
  assert.equal(changePercent(20, 10), 100);
  assert.equal(changePercent(5, 10), -50);
});
test("monthly bars retain gaps instead of stitching together missing months", () => {
  assert.deepEqual(lastTwelveMonths("2027-01"), ["2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.equal(previousMonth("2027-01"), "2026-12");
});
test("annual totals require twelve complete monthly values and exclude 2026", () => {
  const rows = Array.from({ length: 12 }, (_, i) => record("2027-" + String(i+1).padStart(2, "0"), { clicks: i+1, ctr: 2 }));
  const index = monthlyIndex(rows);
  assert.equal(annualMetric(index, clicks, 2026), null);
  assert.equal(annualMetric(index, clicks, 2027), 78);
  assert.equal(annualMetric(index, ctr, 2027), null);
  assert.equal(annualMetric(monthlyIndex(rows.slice(0, 11)), clicks, 2027), null);
});
test("duplicate exact-month imports select most recently recorded snapshot", () => {
  const index = monthlyIndex([record("2026-10", { clicks: 15 }), record("2026-10", { clicks: 18 }, { id: "replacement", recordedAt: "2026-11-05T00:00:00Z" })]);
  assert.equal(metricValue(index, clicks, "2026-10"), 18);
});
