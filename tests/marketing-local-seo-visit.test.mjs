import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [detail, seo, proxy, sitemap] = await Promise.all([
  read("src/app/(marketing)/services/[slug]/page.tsx"),
  read("src/lib/marketing-seo.ts"),
  read("src/proxy.ts"),
  read("src/app/sitemap.ts")
]);
test("every service detail template exposes shop visit info from the same shop record", () => {
  assert.match(detail, /shopAddress\(shop\)/);
  assert.match(detail, /shop\.hours/);
  assert.match(detail, /<ServiceVisitDetails shop=\{shop\} \/>/g);
  assert.equal((detail.match(/<ServiceVisitDetails shop=\{shop\} \/>/g)||[]).length, 2);
  assert.match(detail, /Google.*maps\/search\/\?api=1&query=/s);
  assert.match(detail, /encodeURIComponent\(address\)/);
  assert.match(detail, /if \(!address\) return null/);
  assert.match(detail, /rel="noopener noreferrer"/);
  assert.match(detail, /Request Service/);
  assert.match(detail, /appointment\?service=\$\{service\.slug\}/);
});
test("local SEO remains tenant-backed; no fake ratings or new routes", () => {
  assert.match(detail, /getPublicSeoShop\(\)/);
  assert.match(detail, /"@type": "Service"/);
  assert.match(detail, /"@type": "BreadcrumbList"/);
  assert.match(seo, /openingHoursSpecifications\(shop\.hours\)/);
  assert.doesNotMatch(detail, /AggregateRating|Review count|Sunday open|Open now|guaranteed appointment/i);
  assert.match(proxy, /"\/services"/);
  assert.match(proxy, /pathname\.startsWith\("\/services\/"\)/);
  assert.match(proxy, /"\/services\/:path\*"/);
  assert.match(proxy, /"\/warranty"/);
  assert.match(proxy, /"\/reviews"/);
  assert.match(sitemap, /services\.map\(\(\{ slug \}\)/);
});
