import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("approved Car Doc dev marketing snapshot is complete and public only", async () => {
  const data = JSON.parse(await source("src/data/cardoc-dev-public-marketing.json"));
  assert.equal(data.brandName, "Car Doc");
  assert.equal(data.services.length, 10);
  assert.ok(data.services.every((item) => item.content?.faqs?.length), "all services have full detail and FAQs");
  assert.equal(data.settings.hoursText, "Monday-Friday: 9:00 AM-6:00 PM\\nSaturday: 9:00 AM-3:00 PM\\nSunday: Closed".replaceAll("\\n", "\n"));
  assert.equal(data.media.length, 6);
  assert.ok(data.gallery.length >= 8);
  assert.ok(!("customers" in data) && !("repairOrders" in data) && !("payments" in data));
});

test("dev public identity cannot activate in production or unscoped previews", async () => {
  const gate = await source("src/lib/cardoc-dev-public-marketing-parity.ts");
  for (const part of ['VERCEL_ENV === "preview"', 'VERCEL_GIT_COMMIT_REF === "dev"', 'NEXT_PUBLIC_SITE_URL === "https://dev.subbuscardoc.com"']) assert.ok(gate.includes(part));
  const shop = await source("src/lib/marketing.ts");
  assert.ok(shop.includes("cardocDevPublicMarketingParityEnabled() ? cardocDevPublicShopDetails : {}"));
  assert.ok(shop.includes("...shops[0]"), "dev shop ID is preserved");
});

test("preview indexing disabled without impacting production", async () => {
  const config = await source("next.config.ts");
  assert.ok(config.includes('process.env.VERCEL_ENV === "preview"'));
  assert.ok(config.includes('key: "X-Robots-Tag"'));
  assert.ok(config.includes("noindex, nofollow, noarchive"));
  const robots = await source("src/app/robots.ts");
  assert.ok(robots.includes("marketingIndexingEnabled()"));
});
