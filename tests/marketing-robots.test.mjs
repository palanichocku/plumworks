import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports;
}

const seo = await loadModule("../src/lib/marketing-seo.ts", {
  "@/lib/marketing": {}, "@/lib/marketing-content": {},
});
const production = {
  NODE_ENV: "production", VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://www.subbuscardoc.com",
};
const privateRoutes = ["/login", "/invite", "/dashboard", "/customers", "/vehicles", "/repair-orders", "/invoices", "/accounts-receivable", "/open-orders", "/reports", "/admin", "/settings", "/search", "/help"];

async function generators(environment) {
  const dependencies = {
    "@/lib/marketing-seo": {
      configuredPublicSiteOrigin: () => seo.configuredPublicSiteOrigin(environment),
      marketingIndexingEnabled: () => seo.marketingIndexingEnabled(environment),
    },
    "@/lib/marketing-content": {
      getMarketingServices: async () => [{ slug: "brakes" }],
      getMarketingCoupons: async () => [{ id: "test-coupon" }],
      getMarketingTestimonials: async () => [{ id: "test-review" }],
      getMarketingGallery: async () => [{ id: "test-photo", imageUrl: "/test.jpg" }],
    },
  };
  return {
    robots: (await loadModule("../src/app/robots.ts", dependencies)).default,
    sitemap: (await loadModule("../src/app/sitemap.ts", dependencies)).default,
  };
}

test("production canonical robots allows crawling, retains private exclusions, and advertises www sitemap", async () => {
  const { robots } = await generators(production);
  assert.equal(seo.marketingIndexingEnabled(production), true);
  assert.deepEqual(robots(), {
    rules: { userAgent: "*", allow: "/", disallow: privateRoutes },
    sitemap: "https://www.subbuscardoc.com/sitemap.xml",
  });
});

test("production sitemap uses configured canonical www origin for every public URL", async () => {
  const { sitemap } = await generators(production);
  const entries = await sitemap();
  assert.deepEqual(entries.map(({ url }) => url), [
    "/", "/services", "/about", "/contact", "/appointment", "/drop-off", "/privacy",
    "/coupons", "/reviews", "/photos", "/services/brakes",
  ].map((path) => `https://www.subbuscardoc.com${path}`));
});

for (const [name, overrides] of [
  ["development", { NODE_ENV: "development" }],
  ["test", { NODE_ENV: "test" }],
  ["Vercel preview", { VERCEL_ENV: "preview" }],
  ["localhost", { NEXT_PUBLIC_SITE_URL: "https://localhost" }],
  ["loopback", { NEXT_PUBLIC_SITE_URL: "https://127.0.0.1" }],
  ["missing origin", { NEXT_PUBLIC_SITE_URL: "" }],
  ["insecure origin", { NEXT_PUBLIC_SITE_URL: "http://www.subbuscardoc.com" }],
  ["preview origin", { NEXT_PUBLIC_SITE_URL: "https://cardoc-git-test-user.vercel.app" }],
]) {
  test(`${name} retains blocked robots and empty sitemap`, async () => {
    const environment = { ...production, ...overrides };
    const { robots, sitemap } = await generators(environment);
    assert.equal(seo.marketingIndexingEnabled(environment), false);
    assert.deepEqual(robots(), { rules: { userAgent: "*", disallow: "/" } });
    assert.deepEqual(await sitemap(), []);
  });
}
