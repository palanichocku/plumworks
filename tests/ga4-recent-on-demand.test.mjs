import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("src/app/(app)/dashboard/website-performance/ga4-recent-visitors-panel.tsx", "utf8");
const actions = readFileSync("src/app/(app)/dashboard/website-performance/ga4-recent-actions.ts", "utf8");
const page = readFileSync("src/app/(app)/dashboard/website-performance/page.tsx", "utf8");

test("recent GA4 fetches run only when enabled, not on initial page render", () => {
  assert.match(panel, /^"use client";/);
  assert.match(panel, /useState\(false\)/);
  assert.match(panel, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(panel, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(panel, /if \(!enabledRef\.current/);
  assert.match(panel, /MIN_REFRESH_MS = 60_000/);
  assert.match(panel, /setTimeout\(\(\) => setCooldownUntil\(0\)/);
  assert.match(panel, /Last updated:/);
  assert.match(panel, /Manual refresh only/);
  assert.match(panel, /role="switch"/);
  assert.match(panel, /loadRecentGa4Visitors\(\)/);
  assert.doesNotMatch(page, /getGa4RecentVisitors\(\)/);
  assert.match(page, /<Ga4RecentVisitorsPanel \/>/);
  assert.match(actions, /^"use server";/);
  assert.match(actions, /await requirePermission\("view_reports"\)/);
  assert.match(actions, /return getGa4RecentVisitors\(\)/);
});

test("switch cannot disable existing public website tracking", () => {
  assert.doesNotMatch(actions, /GA4_MEASUREMENT_ID/);
  assert.doesNotMatch(panel, /GA4_MEASUREMENT_ID/);
  assert.match(panel, /Public website tracking continues normally/);
});
