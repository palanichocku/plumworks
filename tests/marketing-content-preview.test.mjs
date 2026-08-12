import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const moduleDirectory = await mkdtemp(join(tmpdir(), "marketing-preview-module-"));
const moduleFile = join(moduleDirectory, "marketing-content-preview.ts");
const moduleSource = await readFile(new URL("../src/lib/marketing-content-preview.ts", import.meta.url), "utf8");
await writeFile(moduleFile, moduleSource.replace('import "server-only";\n\n', ""));
const { getMarketingContentPreview, marketingContentPreviewEnabled, parseMarketingContentPreview } = await import(moduleFile);

const validDocument = {
  brandName: "Preview Repair",
  settings: { headline: "Preview headline", subheadline: "Preview support", serviceIntro: "Preview services", aboutTitle: "Preview about", aboutBody: "Preview body", contactIntro: "Preview contact", hoursText: "Preview hours", reviewUrl: null },
  pages: [{ slug: "about", title: "About", description: "About preview", body: "Body", active: true }],
  services: [
    { slug: "second", name: "Second", summary: "Second summary", detail: "Second detail", active: true, sortOrder: 20 },
    { slug: "first", name: "First", summary: "First summary", detail: "First detail", active: true, sortOrder: 10 },
  ],
  coupons: [],
  testimonials: [],
  gallery: [],
};

test("preview activation is opt-in, local-development-only, and blocked on Vercel", async () => {
  assert.equal(marketingContentPreviewEnabled({ NODE_ENV: "development" }), false);
  assert.equal(marketingContentPreviewEnabled({ NODE_ENV: "development", MARKETING_CONTENT_PREVIEW_FILE: "/tmp/content.json" }), true);
  assert.equal(marketingContentPreviewEnabled({ NODE_ENV: "production", MARKETING_CONTENT_PREVIEW_FILE: "/tmp/content.json" }), false);
  assert.equal(marketingContentPreviewEnabled({ NODE_ENV: "development", VERCEL: "1", MARKETING_CONTENT_PREVIEW_FILE: "/tmp/content.json" }), false);
  assert.equal(marketingContentPreviewEnabled({ NODE_ENV: "development", VERCEL_ENV: "preview", MARKETING_CONTENT_PREVIEW_FILE: "/tmp/content.json" }), false);
  assert.equal(await getMarketingContentPreview({ NODE_ENV: "production", MARKETING_CONTENT_PREVIEW_FILE: "/missing/production-must-not-read.json" }), null);
});

test("valid deployment content is normalized without inventing optional records", () => {
  const preview = parseMarketingContentPreview(validDocument);
  assert.equal(preview.brandName, "Preview Repair");
  assert.equal(preview.settings.headline, "Preview headline");
  assert.deepEqual(preview.services.map(({ slug, sortOrder }) => ({ slug, sortOrder })), [{ slug: "second", sortOrder: 20 }, { slug: "first", sortOrder: 10 }]);
  assert.deepEqual(preview.coupons, []);
  assert.deepEqual(preview.testimonials, []);
  assert.deepEqual(preview.gallery, []);
  assert.equal(preview.aboutOwner, null);
});

test("active optional preview records receive non-fallback identities for existing navigation and sitemap conditions", () => {
  const preview = parseMarketingContentPreview({
    ...validDocument,
    coupons: [{ title: "Active offer", body: "Offer body", active: true, sortOrder: 1 }, { title: "Inactive offer", body: "Hidden", active: false, sortOrder: 2 }],
    testimonials: [{ quote: "Approved review", active: true, sortOrder: 1 }],
    gallery: [{ title: "Shop exterior", imageUrl: "https://example.test/shop.jpg", active: true, sortOrder: 1 }],
  });
  assert.equal(preview.coupons[0].id, "preview-coupon-0");
  assert.equal(preview.coupons[1].active, false);
  assert.equal(preview.testimonials[0].id, "preview-testimonial-0");
  assert.equal(preview.gallery[0].id, "preview-gallery-0");
  assert.ok([preview.coupons[0].id, preview.testimonials[0].id, preview.gallery[0].id].every((id) => !id.startsWith("fallback-")));
});

test("Car Doc owner content passes the shared content-file validator", async () => {
  const file = new URL("../../plumworks-deployments/clients/cardoc/content/marketing-content.json", import.meta.url);
  const preview = parseMarketingContentPreview(JSON.parse(await readFile(file, "utf8")));
  assert.equal(preview.aboutOwner?.name, "Subbu Veerappan");
  assert.equal(preview.brandName, "Car Doc");
  assert.equal(preview.aboutOwner?.imageUrl, "/client-assets/cardoc/subbu-veerappan-owner.jpg");
});

test("preview file reads successfully and failures are clear without exposing its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "marketing-preview-"));
  const validFile = join(directory, "valid.json");
  const invalidFile = join(directory, "invalid.json");
  await writeFile(validFile, JSON.stringify(validDocument));
  await writeFile(invalidFile, "{not json");
  const environment = (file) => ({ NODE_ENV: "development", MARKETING_CONTENT_PREVIEW_FILE: file });
  assert.equal((await getMarketingContentPreview(environment(validFile)))?.settings.headline, "Preview headline");
  await assert.rejects(getMarketingContentPreview(environment(invalidFile)), /not valid JSON/);
  const missingFile = join(directory, "missing-private-name.json");
  await assert.rejects(getMarketingContentPreview(environment(missingFile)), (error) => error instanceof Error && /could not be read/.test(error.message) && !error.message.includes(missingFile));
  await assert.rejects(getMarketingContentPreview(environment("relative.json")), /must be an absolute path/);
});

test("preview feeds every public content loader and the banner exposes no file path", async () => {
  const [loaders, layout, shell, sitemap] = await Promise.all([
    readFile(new URL("../src/lib/marketing-content.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(marketing)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/marketing/marketing-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/sitemap.ts", import.meta.url), "utf8"),
  ]);
  assert.equal((loaders.match(/await getMarketingContentPreview\(\)/g) ?? []).length, 8);
  assert.ok((loaders.match(/filter\(\(item\) => item\.active\)/g) ?? []).length >= 4);
  assert.match(layout, /previewMode=\{marketingContentPreviewEnabled\(\)\}/);
  assert.match(shell, /Local marketing-content preview — database content is not being used/);
  assert.doesNotMatch(shell + layout, /MARKETING_CONTENT_PREVIEW_FILE|previewFile|filePath/);
  assert.match(sitemap, /getMarketingCoupons\(\)/);
  assert.match(sitemap, /getMarketingTestimonials\(\)/);
  assert.match(sitemap, /getMarketingGallery\(\)/);
});
