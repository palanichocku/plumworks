import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [config, page, trust, home, layout, sitemap] = await Promise.all([
  read("src/lib/marketing-warranty.ts"),
  read("src/app/(marketing)/warranty/page.tsx"),
  read("src/components/marketing/warranty-trust-section.tsx"),
  read("src/app/(marketing)/page.tsx"),
  read("src/app/(marketing)/layout.tsx"),
  read("src/app/sitemap.ts"),
]);

test("warranty is explicitly opt-in, not shown to other tenants", () => {
  assert.match(config, /PLUMWORKS_PUBLIC_WARRANTY_PROGRAMS/);
  assert.match(config, /if \(selection === "both"\)/);
  assert.match(config, /return \[\];/);
  assert.match(page, /if \(!warranties\.length\) notFound\(\)/);
  assert.match(page, /index: warranties\.length > 0/);
  assert.match(layout, /getPublicWarrantyPrograms\(\)\.length \? \["Warranty", "\/warranty"\]/);
  assert.match(sitemap, /getPublicWarrantyPrograms\(\)\.length\) routes\.push\("\/warranty"\)/);
});

test("warranty copy differentiates programs and avoids blanket promises", () => {
  assert.match(config, /Nationwide Protection Plus/);
  assert.match(config, /3 years/);
  assert.match(config, /36,000 miles/);
  assert.match(config, /ProVantage Nationwide Worry-Free Warranty/);
  assert.match(config, /2 years/);
  assert.match(config, /24,000 miles/);
  assert.match(page, /Not every repair is eligible/);
  assert.match(page, /applicable written warranty terms govern/);
  assert.doesNotMatch(config + page + trust, /NAPA|all repairs guaranteed|every repair is covered/i);
});

test("marketing pages show warranty information only if opted in", () => {
  assert.match(home, /<WarrantyTrustSection \/>/);
  assert.match(trust, /if \(!warranties\.length\) return null/);
  assert.match(page, /href="\/appointment"/);
  assert.match(page, /href="\/contact"/);
});
