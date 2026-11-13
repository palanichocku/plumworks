import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("GA4 recent visitor property ID matches a real numeric GA4 ID", () => {
  const src = readFileSync("src/lib/ga4-visitor-report.ts", "utf8");
  const recent = src.slice(src.indexOf("export async function getGa4RecentVisitors"));
  const match = recent.match(/!\((\/\^.*?\$\/)\.test\(property\)\)/);
  assert.ok(match, "expected an explicit GA4 property ID validation");
  const re = new RegExp(match[1].slice(2, -2));
  assert.equal(re.test("564312461"), true);
  assert.equal(re.test("not-a-property"), false);
  assert.doesNotMatch(recent, /\\\\d/);
});
