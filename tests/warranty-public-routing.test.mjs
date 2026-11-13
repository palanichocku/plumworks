import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");

test("warranty is classified as a public marketing route for the production website", () => {
  const allowlist = proxy.match(/const publicMarketingPaths = new Set\((\[[^;]+\])\);/);
  assert.ok(allowlist, "Public marketing allowlist must exist");
  assert.match(allowlist[1], /"\/warranty"/, "Public site /warranty must bypass application session routing");
});

test("warranty is included in the explicit proxy matcher for dev and preview domains", () => {
  const matcher = proxy.slice(proxy.indexOf("export const config ="));
  assert.match(matcher, /"\/warranty"/, "Dev proxy matcher must include /warranty too");
  assert.match(proxy, /if \(isPublicMarketingPath\(pathname\)\)/);
  assert.match(proxy, /return response;/);
});
