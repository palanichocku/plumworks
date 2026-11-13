import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [home, rating, proxy, reviews, reviewLinks, leadActions, call] = await Promise.all([
  read("src/app/(marketing)/page.tsx"),
  read("src/components/marketing/google-rating-mark.tsx"),
  read("src/proxy.ts"),
  read("src/app/(marketing)/reviews/page.tsx"),
  read("src/lib/marketing-review-links.ts"),
  read("src/app/(marketing)/lead-actions.ts"),
  read("src/components/marketing/tracked-call-link.tsx"),
]);

test("review badge uses a validated numeric rating, never an isolated one-star decoration", () => {
  assert.match(home, /PLUMWORKS_PUBLIC_GOOGLE_RATING/);
  assert.match(home, /reviewLinks\.google && Number\.isFinite\(configuredGoogleRating\)/);
  assert.match(home, /<GoogleRatingMark rating=\{googleRating\}/);
  assert.match(rating, /toFixed\(1\)/);
  assert.match(rating, /out of 5 stars/);
  assert.match(rating, /Math\.max\(0, Math\.min\(1, rating - index\)\)/);
  assert.doesNotMatch(home, /className="text-3xl leading-none text-amber-400">★/);
});

test("home and review profile links remain real, attributed and free", () => {
  assert.match(home, /href="\/reviews"/);
  assert.match(home, /id="customer-voices-title"/);
  assert.match(home, /href=\{reviewLinks\.google\}/);
  assert.match(home, /href=\{reviewLinks\.facebook\}/);
  assert.match(home, /<AttributionLink href="\/appointment"/);
  assert.match(home, /<TrackedCallLink/);
  assert.match(home, /aria-label="Quick service actions"/);
  assert.match(reviewLinks, /CAR_DOC_PLACE_ID/);
  assert.match(reviewLinks, /CAR_DOC_FACEBOOK/);
  assert.match(reviews, /Read Google Reviews/);
  assert.match(reviews, /Facebook Recommendations/);
  assert.doesNotMatch(home + rating + reviewLinks, /Google Places API|932 reviews|PLUMWORKS_DEV_CARDOC_REVIEW_PREVIEW/);
});

test("production website routes remain public and protected app paths stay protected", () => {
  const paths = proxy.match(/const publicMarketingPaths = new Set\(\[([^\]]+)\]\)/);
  assert.ok(paths);
  for (const path of ["/", "/reviews", "/warranty", "/appointment", "/contact"]) {
    assert.ok(paths[1].includes(`"${path}"`), `${path} missing from public allowlist`);
    assert.ok(proxy.slice(proxy.indexOf("export const config")).includes(`"${path}"`), `${path} missing from proxy matcher`);
  }
  assert.match(proxy, /hostname === PUBLIC_WEBSITE_HOST && isAppPath\(pathname\)/);
  assert.match(proxy, /if \(isPublicMarketingPath\(pathname\)\)/);
  assert.match(proxy, /return updateSession\(request\);/);
  assert.match(leadActions, /createLead\("APPOINTMENT", formData, "\/appointment"\)/);
  assert.match(call, /sendBeacon\("\/api\/marketing\/call-click"\)/);
});
