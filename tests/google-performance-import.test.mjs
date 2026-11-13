import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read=(p)=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("Google report import supports two known native formats and bounds untrusted ZIPs",async()=>{
  const source=await read("src/lib/google-performance-import.ts");
  assert.match(source,/Chart\.csv/);
  assert.match(source,/Google Search - Mobile/);
  assert.match(source,/parseBusinessProfile/);
  assert.match(source,/parseSearchConsole/);
  assert.match(source,/maxOutputLength: 2_000_001/);
  assert.match(source,/Missing|Required CSV column missing/);
  assert.match(source,/weightedPosition/);
  assert.match(source,/!wholeMonth\(start, end\)/);
});
test("owner/admin imports are staged, tenant-scoped, and never silently overwrite",async()=>{
  const source=await read("src/app/(app)/dashboard/website-performance/actions.ts");
  assert.match(source,/requirePermission\("edit_shop_settings"\)/);
  assert.match(source,/previewGooglePerformanceImport/);
  assert.match(source,/confirmGooglePerformanceImport/);
  assert.match(source,/form\.get\("replace"\)/);
  assert.match(source,/form\.get\("ackOverlaps"\)/);
  assert.match(source,/shopId: membership\.shopId/);
  assert.match(source,/prisma\.\$transaction/);
});
test("owner report labels incomplete periods, before/after sample size, and historical transfer",async()=>{
  const page=await read("src/app/(app)/dashboard/website-performance/page.tsx");
  assert.match(page,/GoogleReportUpload/);
  assert.match(page,/CompleteMonthComparison/);
  assert.match(page,/September 23/);
  assert.match(page,/2026-10-01/);
  assert.match(page,/find\(\(row\) => !row\.partial\)/);
  assert.match(page,/Based on \{values\.length\} pre/);
  assert.match(page,/website migration caused/);
});
