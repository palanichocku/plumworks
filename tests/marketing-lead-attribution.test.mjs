import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attributionLimits,
  captureFirstTouch,
  leadAttributionData,
  normalizeAttributionPath,
  normalizeAttributionReferrer,
  normalizedLeadAttributionSummary,
  parseFirstTouch,
  preserveFirstTouch,
} from "../src/lib/marketing-attribution.ts";

const touch = (query = "", overrides = {}) => captureFirstTouch({
  searchParams: new URLSearchParams(query),
  pathname: "/services/brakes",
  origin: "https://shop.example",
  now: new Date("2026-08-04T12:00:00.000Z"),
  ...overrides,
});

test("supported UTM and click identifiers are captured with explicit limits", () => {
  const captured = touch(`utm_source=google&utm_medium=cpc&utm_campaign=brakes&utm_term=noise&utm_content=ad-a&gclid=${"g".repeat(500)}&fbclid=facebook&msclkid=microsoft`);
  assert.equal(captured.source, "google");
  assert.equal(captured.medium, "cpc");
  assert.equal(captured.campaign, "brakes");
  assert.equal(captured.term, "noise");
  assert.equal(captured.content, "ad-a");
  assert.equal(captured.googleClickId?.length, attributionLimits.clickId);
  assert.equal(captured.facebookClickId, "facebook");
  assert.equal(captured.microsoftClickId, "microsoft");
});

test("unsupported and sensitive query parameters are ignored", () => {
  const captured = touch("email=person%40example.test&phone=5551234567&vin=private&message=private-comment&unsupported=value");
  const serialized = JSON.stringify(captured);
  for (const sensitive of ["person@example.test", "5551234567", "private-comment", "private", "unsupported"]) assert.doesNotMatch(serialized, new RegExp(sensitive));
  assert.equal(captured.source, "direct");
});

test("first touch survives navigation and internal referrers never replace it", () => {
  const original = touch("utm_source=google&utm_campaign=first", { pathname: "/" });
  const preserved = preserveFirstTouch(JSON.stringify(original), { searchParams: new URLSearchParams("utm_source=facebook&utm_campaign=second"), pathname: "/appointment", origin: "https://shop.example", referrer: "https://shop.example/services" });
  assert.equal(preserved.source, "google");
  assert.equal(preserved.campaign, "first");
  assert.equal(preserved.landingPath, "/");
  assert.equal(normalizeAttributionReferrer("https://shop.example/services?email=private", "https://shop.example"), null);
});

test("malformed and obsolete cookie versions fail safely", () => {
  assert.equal(parseFirstTouch("not-json"), null);
  assert.equal(parseFirstTouch(JSON.stringify({ ...touch("utm_source=old"), version: 0 })), null);
  assert.equal(parseFirstTouch(JSON.stringify({ source: "old", landingPath: "/", firstTouchAt: new Date().toISOString() })), null);
  assert.equal(preserveFirstTouch(JSON.stringify({ ...touch("utm_source=old"), version: 2 }), { searchParams: new URLSearchParams("utm_source=new"), pathname: "/contact", origin: "https://shop.example" }).source, "new");
});

test("direct and referral traffic are represented consistently", () => {
  assert.equal(touch().source, "direct");
  const referral = touch("", { referrer: "https://referrer.example/article?person=private#section" });
  assert.equal(referral.source, "referral");
  assert.equal(referral.medium, "referral");
  assert.equal(referral.referrer, "https://referrer.example/article");
  assert.equal(leadAttributionData(null, "/contact").attributionSource, "direct");
});

test("unsafe URLs and malformed paths are rejected", () => {
  assert.equal(normalizeAttributionReferrer("javascript:alert(1)"), null);
  assert.equal(normalizeAttributionReferrer("not a url"), null);
  assert.equal(normalizeAttributionReferrer("https://user:secret@example.test/path"), null);
  assert.equal(normalizeAttributionPath("https://attacker.example/path"), null);
  assert.equal(normalizeAttributionPath("//attacker.example/path"), null);
  assert.equal(normalizeAttributionPath("/appointment?email=private#fragment"), "/appointment");
});

test("existing source enum remains the form type for all lead workflows", async () => {
  const action = await readFile(new URL("../src/app/(marketing)/lead-actions.ts", import.meta.url), "utf8");
  assert.match(action, /createLead\("CONTACT", formData, "\/contact"\)/);
  assert.match(action, /createLead\("APPOINTMENT", formData, "\/appointment"\)/);
  assert.match(action, /createLead\("DROP_OFF", formData, "\/drop-off"\)/);
  assert.equal(normalizedLeadAttributionSummary({ source: "DROP_OFF", attributionSource: "direct" }).formType, "drop-off");
});

test("proxy initializes attribution only on public marketing page entry requests", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /request\.method === "GET" \|\| request\.method === "HEAD"/);
  for (const route of ["/", "/about", "/appointment", "/contact", "/coupons", "/drop-off", "/photos", "/privacy", "/reviews", "/services/:path*"]) assert.match(proxy, new RegExp(`"${route.replace(/[/*]/g, "\\$&")}"`));
  for (const excluded of ["/_next", "/api/", "/robots.txt", "/sitemap.xml", "/favicon.ico"]) assert.doesNotMatch(proxy, new RegExp(`"${excluded.replace(/[/*]/g, "\\$&")}`));
});

test("attribution absence cannot block lead data construction", () => {
  const data = leadAttributionData(undefined, "/drop-off", new Date("2026-08-04T12:00:00.000Z"));
  assert.equal(data.attributionSource, "direct");
  assert.equal(data.landingPath, "/drop-off");
  assert.equal(data.submissionPath, "/drop-off");
});

test("call clicks remain recognizable and use attribution without becoming form submissions", async () => {
  const [route, context] = await Promise.all([
    readFile(new URL("../src/app/api/marketing/call-click/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/marketing-lead-context.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /callClickMessage/);
  assert.match(route, /leadAttributionData/);
  assert.match(context, /Visitor clicked Call Now/);
  assert.doesNotMatch(route, /formData|requestedService|vehicleMake|vehicleModel|utm_/);
});
