import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [home, layout, shell, content, attribution, call, leadActions, leadForm, privacy, coupons, reviews, photos, sitemap, emptyCollection] = await Promise.all([
  read("src/app/(marketing)/page.tsx"),
  read("src/app/(marketing)/layout.tsx"),
  read("src/components/marketing/marketing-shell.tsx"),
  read("src/lib/marketing-content.ts"),
  read("src/components/marketing/attribution-link.tsx"),
  read("src/components/marketing/tracked-call-link.tsx"),
  read("src/app/(marketing)/lead-actions.ts"),
  read("src/components/marketing/lead-form.tsx"),
  read("src/app/(marketing)/privacy/page.tsx"),
  read("src/app/(marketing)/coupons/page.tsx"),
  read("src/app/(marketing)/reviews/page.tsx"),
  read("src/app/(marketing)/photos/page.tsx"),
  read("src/app/sitemap.ts"),
  read("src/components/marketing/empty-marketing-collection.tsx"),
]);

test("homepage identity and copy remain database-backed and shop-generic", () => {
  assert.match(home, /getPublicShop\(\)/);
  assert.match(home, /getMarketingSettings\(\)/);
  assert.match(home, /settings\.headline/);
  assert.match(home, /settings\.subheadline/);
  assert.match(home, /settings\.serviceIntro/);
  assert.match(home, /settings\.aboutTitle/);
  assert.match(home, /settings\.aboutBody/);
  assert.match(home + shell, /shop\.name/);
  assert.doesNotMatch(home + shell + privacy, /Car Doc|CAR DOC|BBM5648|VEETTIL/);
});

test("homepage renders no empty service grid and limits prioritized active services to six", () => {
  assert.match(content, /marketingService\.findMany\(\{ where: \{ shopId: shop\.id, active: true \}/);
  assert.match(content, /orderBy: \[\{ sortOrder: "asc" \}, \{ name: "asc" \}\]/);
  assert.match(home, /featuredServices = services\.filter[\s\S]*\.slice\(0, 6\)/);
  assert.match(home, /\{featuredServices\.length \? <section/);
  assert.match(home, /href="\/services"/);
});

test("placeholder or empty reviews, coupons, and gallery items never render", () => {
  assert.match(home, /activeTestimonials = testimonials\.filter\(\(item\) => !item\.id\.startsWith\("fallback-"\) && item\.quote\.trim\(\)\)\.slice\(0, 3\)/);
  assert.match(home, /activeCoupon = coupons\.find\(\(item\) => !item\.id\.startsWith\("fallback-"\) && item\.title\.trim\(\) && item\.body\.trim\(\)\)/);
  assert.match(home, /heroImage = gallery\.find\(\(item\) => !item\.id\.startsWith\("fallback-"\)/);
  assert.match(home, /\{activeTestimonials\.length \? <section/);
  assert.match(home, /\{activeCoupon \? <section/);
  assert.match(home, /heroImage \? <div role="img"/);
  assert.doesNotMatch(home, /Review placeholder|Photo placeholder|Ask About Current Offers/);
});

test("homepage conversion actions preserve existing lead and call workflows", () => {
  assert.match(home + shell, /TrackedCallLink/);
  assert.match(call, /sendBeacon\("\/api\/marketing\/call-click"\)/);
  assert.match(home + shell, /href="\/appointment"/);
  assert.match(leadActions, /createLead\("APPOINTMENT", formData, "\/appointment"\)/);
  assert.match(leadActions, /shopId: shops\[0\]\.id, source/);
  assert.match(leadForm, /Submitting a request does not guarantee a time/);
  assert.match(home, /Submitting a request does not confirm an appointment/);
});

test("internal marketing links retain recognized attribution parameters", () => {
  for (const parameter of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]) assert.match(attribution, new RegExp(`"${parameter}"`));
  assert.match(attribution, /current\.entries\(\)/);
  assert.match(attribution, /query\.append\(key, value\)/);
  assert.match(home + shell, /AttributionLink/);
});

test("shared header, mobile navigation, location, and footer expose valid essential actions", () => {
  assert.match(shell, /aria-label="Primary navigation"/);
  assert.match(shell, /<details className="group relative lg:hidden">/);
  assert.match(shell, /aria-label="Mobile navigation"/);
  assert.match(shell, /Request Service/);
  assert.match(home, /Get Directions/);
  assert.match(home, /Current hours/);
  assert.match(shell, /href="\/privacy"/);
  assert.match(privacy, /Website privacy/);
  assert.doesNotMatch(shell, /social|partner/i);
});

test("homepage includes the requested semantic sections and professional image fallback", () => {
  for (const heading of ["Core services", "Why choose this shop", "How requesting service works", "Customer reviews", "Current promotion", "Location and contact"]) assert.match(home, new RegExp(heading));
  assert.match(home, /Tell the shop what is happening/);
  assert.match(home, /The shop follows up/);
  assert.match(home, /Review the recommendation/);
  assert.match(home, /background-image:linear-gradient/);
  assert.doesNotMatch(home, /images\.unsplash|pexels|subbuscardoc/i);
});

test("optional navigation and sitemap routes require real configured content", () => {
  assert.match(layout, /!item\.id\.startsWith\("fallback-"\)/);
  assert.match(layout, /optionalLinks=\{optionalLinks\}/);
  assert.match(shell, /navigationLinks = \[\.\.\.primaryLinks, \.\.\.optionalLinks\]/);
  assert.match(sitemap, /if \(coupons\.some/);
  assert.match(sitemap, /if \(testimonials\.some/);
  assert.match(sitemap, /if \(gallery\.some/);
  assert.doesNotMatch(sitemap, /const routes = \[[^\]]*\/coupons/);
});

test("empty optional pages suppress placeholders, use noindex, and keep useful actions", () => {
  for (const page of [coupons, reviews, photos]) {
    assert.match(page, /startsWith\("fallback-"\)/);
    assert.match(page, /robots: [^\n]*\{ index: false, follow: true \}/);
    assert.match(page, /EmptyMarketingCollection/);
  }
  for (const destination of ["/appointment", "/services", "/"]) assert.match(emptyCollection, new RegExp(`href="${destination.replace("/", "\\/")}"`));
  assert.match(emptyCollection, /TrackedCallLink/);
  assert.doesNotMatch(coupons + reviews + photos, /Photo placeholder|Review placeholder|Ask About Current Offers/);
});
