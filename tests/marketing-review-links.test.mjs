import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(new URL("../src/lib/marketing-review-links.ts", import.meta.url), "utf8");
const directory = await mkdtemp(join(tmpdir(), "marketing-review-links-"));
const moduleFile = join(directory, "review-links.ts");
await writeFile(moduleFile, `function shopAddress(shop) { return [shop.addressLine1, [shop.city, shop.state].filter(Boolean).join(", "), shop.postalCode].filter(Boolean).join(" "); }\n${source.replace(/^import .*;\n/gm, "")}`);
const { getReviewLinks } = await import(moduleFile);

const carDoc = { name: "Car Doc", addressLine1: "42464 MOUND ROAD", city: "Sterling Heights", state: "MI", postalCode: "48314", phone: "586-843-3347" };

test("Car Doc's verified profiles are available without credentials or rating claims", () => {
  const links = getReviewLinks(carDoc);
  assert.match(links.google, /query_place_id=ChIJ6c7M8uXcJIgRB8kgW2jUZ9A/);
  assert.equal(links.facebook, "https://www.facebook.com/subbuscardoc/");
  assert.equal(links.leaveGoogle, links.google);
  assert.doesNotMatch(source, /AggregateRating|reviewCount|rating:\s*[1-5]/);
});

test("other tenants never inherit Car Doc's review destinations", () => {
  for (const shop of [{ ...carDoc, phone: "586-000-0000" }, { ...carDoc, addressLine1: "100 Other Road" }])
    assert.deepEqual(getReviewLinks(shop, "https://g.page/other/review"), { google: null, facebook: null, leaveGoogle: null });
});

test("only trusted HTTPS Google review destinations replace the Google profile fallback", () => {
  assert.equal(getReviewLinks(carDoc, "https://g.page/r/ABC/review").leaveGoogle, "https://g.page/r/ABC/review");
  for (const unsafe of ["http://www.google.com/review", "https://google.com.evil.test/", "javascript:alert(1)", "https://user:pass@google.com/review"])
    assert.equal(getReviewLinks(carDoc, unsafe).leaveGoogle, getReviewLinks(carDoc).google);
});


test("Car Doc public review preview is dev-branch-only, opt-in, and tied to the synthetic shop", () => {
  const synthetic = { name: "Car Doc Development", addressLine1: "100 Test Drive", city: "Test City", state: "MI", phone: "555-0100" };
  const old = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW: process.env.PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW,
  };
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "dev";
    process.env.PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW = "true";
    const links = getReviewLinks(synthetic);
    assert.match(links.google, /query_place_id=ChIJ6c7M8uXcJIgRB8kgW2jUZ9A/);
    assert.match(links.google, /Car%20Doc/);
    assert.equal(links.facebook, "https://www.facebook.com/subbuscardoc/");

    process.env.VERCEL_ENV = "production";
    assert.deepEqual(getReviewLinks(synthetic), { google: null, facebook: null, leaveGoogle: null });
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "other-branch";
    assert.deepEqual(getReviewLinks(synthetic), { google: null, facebook: null, leaveGoogle: null });
    process.env.VERCEL_GIT_COMMIT_REF = "dev";
    process.env.PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW = "false";
    assert.deepEqual(getReviewLinks(synthetic), { google: null, facebook: null, leaveGoogle: null });
    process.env.PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW = "true";
    assert.deepEqual(getReviewLinks({ ...synthetic, phone: "555-0111" }), { google: null, facebook: null, leaveGoogle: null });
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
