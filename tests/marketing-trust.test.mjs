import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [deploymentSource, home, about, contact, reviews, photos, loader, preview, importer, sitemap, layout, seo] = await Promise.all([
  read("../plumworks-deployments/clients/cardoc/content/marketing-content.json"),
  read("src/app/(marketing)/page.tsx"),
  read("src/app/(marketing)/about/page.tsx"),
  read("src/app/(marketing)/contact/page.tsx"),
  read("src/app/(marketing)/reviews/page.tsx"),
  read("src/app/(marketing)/photos/page.tsx"),
  read("src/lib/marketing-content.ts"),
  read("src/lib/marketing-content-preview.ts"),
  read("scripts/import-marketing-content.mjs"),
  read("src/app/sitemap.ts"),
  read("src/app/(marketing)/layout.tsx"),
  read("src/lib/marketing-seo.ts"),
]);
const content = JSON.parse(deploymentSource);
const owner = content.aboutOwner;

test("verified Car Doc identity and owner trust facts come from deployment content", () => {
  assert.equal(content.brandName, "Car Doc");
  assert.equal(owner.name, "Subbu Veerappan");
  assert.equal(owner.role, "Owner and ASE Master Technician");
  assert.match(owner.biography, /serving drivers in Sterling Heights/);
  assert.match(owner.biography, /since 2009/);
  assert.match(owner.historyLabel, /Sterling Heights area since 2009/);
  assert.match(owner.biography, /clear explanations and practical recommendations before repair work begins/);
  assert.doesNotMatch(deploymentSource, /all technicians.*ASE|ASE-certified shop|best mechanic|#1|most trusted|highest rated/i);
});

test("homepage presents a compact owner-led trust block and the five-step approval process", () => {
  assert.match(home, /getMarketingAboutOwner\(\)/);
  assert.match(home, /owner\.name/);
  assert.match(home, /owner\.role/);
  assert.match(home, /owner\.historyLabel/);
  assert.match(home, /owner\.homepageSummary/);
  assert.match(home, /href="\/about"/);
  assert.match(home, /Meet the owner/);
  assert.match(home, /<Image src=\{owner\.imageUrl\} alt=\{owner\.imageAlt\} width=\{96\} height=\{120\}/);
  for (const step of ["Explain the concern", "Evaluate the vehicle", "Review the findings", "Discuss the options", "Approve the work"]) assert.match(home, new RegExp(step));
  assert.doesNotMatch(home, /["']Car Doc["']|Subbu Veerappan|since 2009/);
});

test("About scopes the credential to Subbu and uses approved customer-specific principles", () => {
  assert.match(about, /owner\.name/);
  assert.match(about, /owner\.role/);
  assert.match(about, /owner\.biography/);
  assert.match(about, /owner\.principles/);
  assert.match(about, /owner\.historyLabel/);
  assert.match(about, /alt=\{owner\.imageAlt\}/);
  assert.equal(owner.imageAlt, "Subbu Veerappan, owner of Car Doc");
  assert.doesNotMatch(about, /all technicians.*ASE|ASE-certified shop/i);
});

test("contact retains authoritative location, hours, tracked phone, and lightweight directions", () => {
  const contactPage = content.pages.find(({ slug }) => slug === "contact");
  assert.match(contactPage.body, /42464 Mound Road, Sterling Heights, MI 48314/);
  assert.match(contactPage.body, /586-843-3347/);
  assert.equal(content.settings.hoursText, "Monday-Friday: 9:00 AM-6:00 PM\nSaturday: 9:00 AM-3:00 PM\nSunday: Closed");
  assert.match(contact, /TrackedCallLink href=\{phoneHref\(shop\.phone\)\}/);
  assert.match(contact, /google\.com\/maps\/search/);
  assert.match(contact, /Get Directions/);
});

test("reviews and photos remain genuine-data-only and hidden while empty", () => {
  assert.deepEqual(content.testimonials, []);
  assert.deepEqual(content.gallery, []);
  assert.equal(content.settings.reviewUrl, null);
  assert.match(loader, /fallbackTestimonials[\s\S]*rating: null/);
  assert.doesNotMatch(reviews, /rating \?\? 5/);
  assert.match(reviews, /item\.rating \?/);
  assert.match(reviews, /index: hasTestimonials/);
  assert.match(photos, /index: hasPhotos/);
  assert.match(layout, /testimonials\.some[\s\S]*\? \["Reviews", "\/reviews"\] : null/);
  assert.match(layout, /gallery\.some[\s\S]*\? \["Photos", "\/photos"\] : null/);
  assert.match(sitemap, /if \(testimonials\.some/);
  assert.match(sitemap, /if \(gallery\.some/);
  assert.doesNotMatch(deploymentSource, /AggregateRating|"@type"\s*:\s*"Review"/);
  assert.doesNotMatch(seo, /AggregateRating|"@type"\s*:\s*"Review"/);
});

test("reserved owner trust projection remains backward compatible and non-routable", () => {
  for (const field of ["homepageSummary", "historyLabel", "principles"]) {
    assert.match(preview, new RegExp(field));
    assert.match(importer, new RegExp(field));
    assert.match(loader, new RegExp(field));
  }
  assert.match(loader, /slug: "about-owner", active: true/);
  assert.doesNotMatch(sitemap + layout, /about-owner|marketing-brand/);
  assert.doesNotMatch(loader, /Subbu|Car Doc|Sterling Heights|since 2009/);
});
