import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Batch 4 metrics exclude call-click pseudo-leads from dashboard totals", async () => {
  const dashboard = await read("src/lib/data/dashboard.ts");
  assert.match(dashboard, /operationalMarketingLeadWhere\(shopId\).*createdAt:/);
  assert.match(dashboard, /operationalMarketingLeadWhere\(shopId, "CONVERTED"\)/);
  assert.match(dashboard, /convertedAt: \{ gte: currentMonth\.start, lt: currentMonth\.endExclusive \}/);
  assert.doesNotMatch(dashboard, /operationalMarketingLeadWhere\(shopId, "CONVERTED"\), createdAt:/);
  assert.match(dashboard, /marketingLeads: \{ some: operationalMarketingLeadWhere\(shopId\) \}/);
  assert.match(dashboard, /invoice: \{ shopId, status: \{ not: "void" \}/);
  const page = await read("src/app/(app)/dashboard/page.tsx");
  assert.match(page, /Converted during this month/);
  assert.doesNotMatch(page, /website\.conversionRate/);
  assert.match(page, /not to a specific repair order/);
});
test("Batch 4 stores isolated marketing data with RLS rather than mutating operational tables", async () => {
  const migration = await read("prisma/migrations/20261113190000_marketing_performance_snapshots/migration.sql");
  const schema = await read("prisma/schema.prisma");
  assert.match(migration, /marketing_performance_snapshots/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL.*anon, authenticated/);
  assert.doesNotMatch(migration, /ALTER TABLE (customers|invoices|repair_orders|payments|marketing_leads)/i);
  assert.match(schema, /model MarketingPerformanceSnapshot/);
});
test("Batch 4 reporting preserves exact range and avoids fake complete-month bars", async () => {
  const page = await read("src/app/(app)/dashboard/website-performance/page.tsx");
  const action = await read("src/app/(app)/dashboard/website-performance/actions.ts");
  assert.match(page, /!row\.partial/);
  assert.match(page, /2026-10-01/);
  assert.match(page, /reportingStart = "2026-10-01"/);
  assert.match(page, /date\\(row\\.periodStart\\) >= reportingStart/);
  assert.match(page, /const reportingSnapshots = snapshots\\.filter/);
  assert.match(page, /reportingSnapshots\\.map/);
  assert.match(page, /Earlier imports are retained/);
  assert.doesNotMatch(page, /CompleteMonthComparison|Website migration impact|June–August|September 23|post-cutover/i);
  assert.match(page, /GoogleReportUpload/);
  assert.match(page, /saveMarketingSnapshot/);
  assert.match(action, /requirePermission\("edit_shop_settings"\)/);
  assert.match(action, /upsert\(/);
  assert.match(action, /Date\.UTC/);
});
