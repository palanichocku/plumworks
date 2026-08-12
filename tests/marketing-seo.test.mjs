import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [seoSource, home, about, services, servicePage, sitemap, robots, appLayout, documentLayout, login, invite, attribution, deploymentContent, deploymentReadme] = await Promise.all([
  read("src/lib/marketing-seo.ts"), read("src/app/(marketing)/page.tsx"), read("src/app/(marketing)/about/page.tsx"), read("src/app/(marketing)/services/page.tsx"), read("src/app/(marketing)/services/[slug]/page.tsx"), read("src/app/sitemap.ts"), read("src/app/robots.ts"), read("src/app/(app)/layout.tsx"), read("src/app/(documents)/layout.tsx"), read("src/app/login/page.tsx"), read("src/app/invite/page.tsx"), read("src/lib/marketing-attribution.ts"), read("../plumworks-deployments/clients/cardoc/content/marketing-content.json"), read("../plumworks-deployments/clients/cardoc/README.md"),
]);

const moduleDirectory = await mkdtemp(join(tmpdir(), "marketing-seo-module-"));
const moduleFile = join(moduleDirectory, "marketing-seo.ts");
await writeFile(moduleFile, seoSource.replace(/^import .*;\n/gm, "").replace(/export async function getPublicSeoShop[\s\S]*?\n}\n/, "").replace(/: Metadata/g, ""));
const seo = await import(moduleFile);
const production = { NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://cardoc-rho.vercel.app/" };

test("configured canonical origin is explicit, clean, and rejects unsafe hosts", () => {
  assert.equal(seo.configuredPublicSiteOrigin(production).origin, "https://cardoc-rho.vercel.app");
  for (const value of ["http://localhost:3000", "https://www.subbuscardoc.com", "https://cardoc-git-seo-user.vercel.app", "https://cardoc-rho.vercel.app/path?utm_source=x"]) assert.equal(seo.configuredPublicSiteOrigin({ NEXT_PUBLIC_SITE_URL: value }), null);
  assert.equal(seo.configuredPublicSiteOrigin({ VERCEL_URL: "preview.vercel.app" }), null);
  assert.equal(seo.canonicalUrl("/services/brakes?utm_source=test", production).href, "https://cardoc-rho.vercel.app/services/brakes");
  assert.match(deploymentReadme, /NEXT_PUBLIC_SITE_URL=https:\/\/cardoc-rho\.vercel\.app/);
  assert.doesNotMatch(seoSource, /process\.env\.VERCEL_URL/);
});

test("homepage and About metadata are local, unique, canonical, and social-ready", () => {
  assert.match(home, /getPublicSeoShop\(\)/);
  assert.match(home, /localTitle\("Auto Repair", shop\)/);
  assert.match(home, /Auto repair, maintenance, diagnostics, brake service and more/);
  assert.match(home, /path: "\/"/);
  assert.match(about, /About \$\{shop\.name\} \| \$\{subject\}/);
  assert.match(about, /served \$\{shop\.city/);
  assert.match(seoSource, /alternates: \{ canonical \}/);
  assert.match(seoSource, /openGraph: \{ type: "website", title, description, url: canonical, siteName \}/);
  assert.match(seoSource, /twitter: \{ card: "summary", title, description \}/);
});

test("all ten actual Car Doc services receive distinct local SEO titles and descriptions", () => {
  const content = JSON.parse(deploymentContent);
  assert.equal(content.services.length, 10);
  const titles = content.services.map((service) => seo.serviceSeoTitle(service.slug, service.name));
  assert.equal(new Set(titles).size, 10);
  assert.ok(titles.every((title) => title !== "Local Auto Repair"));
  assert.match(servicePage, /path: `\/services\/\$\{slug\}`/);
  assert.match(servicePage, /service\.summary/);
  assert.match(servicePage, /Contact \$\{shop\.name\}/);
  assert.match(services, /marketingMetadata/);
});

test("AutoRepair structured data uses authoritative shop identity, structured address, and parsed hours", () => {
  const shop = { name: "Car Doc", legalName: "CAR DOC LLC", phone: "586-843-3347", addressLine1: "42464 Mound Road", city: "Sterling Heights", state: "MI", postalCode: "48314", hours: JSON.parse(deploymentContent).settings.hoursText };
  const data = seo.autoRepairJsonLd(shop, production);
  assert.equal(data["@type"], "AutoRepair");
  assert.equal(data.name, "Car Doc");
  assert.equal(data.legalName, "CAR DOC LLC");
  assert.equal(data.telephone, "586-843-3347");
  assert.deepEqual(data.address, { "@type": "PostalAddress", streetAddress: "42464 Mound Road", addressLocality: "Sterling Heights", addressRegion: "MI", postalCode: "48314", addressCountry: "US" });
  assert.equal(data.openingHoursSpecification.length, 2);
  assert.doesNotMatch(JSON.stringify(data), /AggregateRating|localhost|subbuscardoc/i);
  assert.match(home, /autoRepairJsonLd\(seoShop\)/);
});

test("service pages expose accurate Service and BreadcrumbList data without fabricated FAQ or ratings", () => {
  assert.match(servicePage, /"@type": "Service"/);
  assert.match(servicePage, /"@type": "BreadcrumbList"/);
  assert.match(servicePage, /Home[\s\S]*Services[\s\S]*service\.name/);
  assert.match(servicePage, /provider: \{ "@id": `\$\{serviceUrl\.origin\}\/\#business`, name: shop\.name \}/);
  assert.doesNotMatch(servicePage, /FAQPage|AggregateRating|reviewCount|priceRange/);
});

test("public brand comes from tenant marketing content instead of a shared Car Doc hardcode", () => {
  const content = JSON.parse(deploymentContent);
  assert.equal(content.brandName, "Car Doc");
  const shop = seo.publicSeoShop({ name: "CAR DOC LLC", city: "Sterling Heights", state: "MI" }, content.brandName);
  assert.equal(shop.name, "Car Doc");
  assert.equal(shop.legalName, "CAR DOC LLC");
  assert.equal(seo.localTitle("Auto Repair", shop), "Auto Repair in Sterling Heights, MI | Car Doc");
  assert.equal(seo.localTitle("Brake Repair", shop), "Brake Repair in Sterling Heights, MI | Car Doc");
  assert.equal(seo.localTitle("Oil Change", shop), "Oil Change in Sterling Heights, MI | Car Doc");
  assert.equal(seo.localTitle("Check Engine Light & Diagnostics", shop), "Check Engine Light & Diagnostics in Sterling Heights, MI | Car Doc");
  assert.match(seoSource, /getMarketingBrandName\(\)/);
  assert.match(seoSource, /name: publicName, legalName:/);
  assert.doesNotMatch(seoSource, /["']Car Doc["']|CAR DOC LLC/);
  for (const source of [home, about, servicePage]) assert.doesNotMatch(source, /["']Car Doc["']|CAR DOC LLC/);
});

test("sitemap and robots use only the configured production origin and exclude private or empty routes", () => {
  assert.match(sitemap, /configuredPublicSiteOrigin\(\)/);
  assert.match(sitemap, /if \(!origin \|\| !marketingIndexingEnabled\(\)\) return \[\]/);
  assert.match(sitemap, /getMarketingServices\(\)/);
  assert.doesNotMatch(sitemap, /localhost|VERCEL_URL|subbuscardoc/);
  assert.doesNotMatch(sitemap, /\/login|\/dashboard|\/customers|\/invoices/);
  assert.match(robots, /"\/login"/);
  for (const route of ["accounts-receivable", "open-orders", "reports", "repair-orders", "invoices", "admin"]) assert.match(robots, new RegExp(route));
  assert.match(robots, /disallow: "\/"/);
});

test("staff, authenticated, document, and invitation surfaces are metadata noindex", () => {
  for (const source of [appLayout, documentLayout, login, invite]) assert.match(source, /robots: \{ index: false, follow: false \}/);
});

test("tracking attribution remains independent from clean canonical generation", () => {
  for (const parameter of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]) assert.match(attribution, new RegExp(parameter));
  assert.doesNotMatch(seoSource, /utm_|gclid|fbclid|msclkid/);
});
