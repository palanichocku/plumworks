import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { median, normalizePageSpeed, summarizePageSpeed, inspectHtml, crawlCandidates, contentSignals, trustSignals, measurementState, validateWeights, scoreBenchmark, assertFreshDeployment, PRIVATE_PATHS, RUBRIC_VERSION, RUBRIC_ITEMS } from "../src/lib/website-benchmark-core.mjs";

const config = JSON.parse(await readFile(new URL("../../plumworks-deployments/clients/cardoc/benchmark/website-benchmark.json", import.meta.url), "utf8"));
const script = await readFile(new URL("../scripts/website-benchmark.mjs", import.meta.url), "utf8");
const engine = await readFile(new URL("../src/lib/website-benchmark-core.mjs", import.meta.url), "utf8");

test("v1 rubric identity and weights are fixed and total exactly 100", () => {
  assert.equal(config.rubricVersion, RUBRIC_VERSION);
  assert.deepEqual(config.weights, { conversionUsability: 25, localSeoReadiness: 20, technicalSeo: 15, performance: 15, contentTrust: 10, accessibilityMobile: 10, measurementAttribution: 5 });
  assert.equal(validateWeights(config.weights), 100);
  assert.deepEqual(Object.fromEntries(Object.entries(RUBRIC_ITEMS).map(([key, items]) => [key, items.length])), { technicalSeo: 13, conversionUsability: 6, localSeoReadiness: 9 });
  assert.throws(() => validateWeights({ ...config.weights, performance: 16 }), /total 100/);
});

test("median and PageSpeed normalization preserve devices, units, CLS, and no fabricated INP", () => {
  assert.equal(median([90, 70, 80]), 80);
  assert.equal(median([70, 80]), 75);
  assert.equal(median([]), null);
  const raw = { lighthouseResult: { lighthouseVersion: "12.3", categories: { performance: { score: .81 }, accessibility: { score: .94 }, "best-practices": { score: .96 }, seo: { score: 1 } }, audits: { "largest-contentful-paint": { numericValue: 2450 }, "cumulative-layout-shift": { numericValue: .073 }, "total-blocking-time": { numericValue: 120 }, "speed-index": { numericValue: 2000 }, "first-contentful-paint": { numericValue: 900 } }, runWarnings: [] } };
  const mobile = normalizePageSpeed(raw, { url: "https://example.com/", strategy: "mobile", run: 1, timestamp: "2026-08-13T00:00:00.000Z" });
  const desktop = normalizePageSpeed({ error: { message: "quota" } }, { url: "https://example.com/", strategy: "desktop", run: 1 });
  assert.equal(mobile.categories.performance, 81); assert.equal(mobile.metrics.lcpMs, 2450); assert.equal(mobile.metrics.cls, .073); assert.equal(mobile.metrics.inpMs, null); assert.deepEqual(mobile.fieldData, { status: "insufficient_data" });
  assert.equal(desktop.error, "quota");
  const summary = summarizePageSpeed([mobile, { ...mobile, run: 2, categories: { ...mobile.categories, performance: 91 } }, desktop]);
  assert.equal(summary.mobile.categories.performance, 86); assert.equal(summary.desktop.successfulRuns, 0); assert.equal(summary.desktop.categories.performance, null); assert.equal(summary.mobile.inpMs, null);
});

test("HTML audit detects metadata, canonicals, JSON-LD, links, and analytics deterministically", () => {
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Brake Service</title><meta name="description" content="Useful brakes"><link rel="canonical" href="https://example.com/brakes"><meta property="og:title" content="Brake"><meta property="og:description" content="OG"><meta property="og:url" content="https://example.com/brakes"><meta name="twitter:card" content="summary"><script type="application/ld+json">{"@type":"Service"}</script><script src="https://www.googletagmanager.com/gtm.js"></script></head><body><h1>Brakes</h1><a href="/contact">Contact</a><a href="https://other.test/">Other</a></body></html>`;
  const page = inspectHtml(html, "https://example.com/brakes?utm_source=x");
  assert.equal(page.title, "Brake Service"); assert.equal(page.description, "Useful brakes"); assert.equal(page.canonical, "https://example.com/brakes"); assert.equal(page.canonicalCorrect, true); assert.deepEqual(page.h1, ["Brakes"]); assert.deepEqual(page.schemaTypes, ["Service"]); assert.equal(page.openGraph.url, "https://example.com/brakes"); assert.equal(page.twitter.card, "summary"); assert.equal(page.analyticsDetected, true); assert.equal(page.hasTelephoneLink, false);
});

test("bounded crawl discovery is same-origin and excludes PlumWorks private paths", () => {
  const page = { links: ["https://example.com/about", "https://example.com/admin", "https://example.com/invoices/1", "https://other.test/page"] };
  assert.deepEqual(crawlCandidates(page, "https://example.com", new Set(), PRIVATE_PATHS), ["https://example.com/about"]);
  assert.match(script, /pages\.length < config\.crawl\.cap/); assert.match(script, /await sleep\(config\.crawl\.delayMs\)/);
  assert.match(script, /new Set\(\[\.\.\.\(titles\.get/);
});

test("content, trust, and conversion scoring are deterministic while unknowns stay unavailable", () => {
  const rich = inspectHtml(`<html lang="en"><head><meta name="viewport" content="width=device-width"><title>Brakes</title><meta name="description" content="Brake help"><link rel="canonical" href="https://example.com/services/brakes"></head><body><h1>Brake Repair</h1><h2>Signs and symptoms</h2><p>${"Sterling Heights warning noise vibration concern inspect evaluate helpful why does not always what to expect approve authorization. ".repeat(20)}</p><h2>Common questions</h2><a href="/services/diagnostics">Related service</a><a href="/appointment">Request Service</a><a href="tel:5868433347">Call</a></body></html>`, "https://example.com/services/brakes");
  const content = contentSignals(rich, { service: true, locality: "Sterling Heights" }); assert.equal(content.passed, 10);
  const trust = trustSignals([{ ...rich, text: `${rich.text} Subbu Veerappan Owner and ASE Master Technician 42464 Mound Road Monday Friday Saturday since 2009 before work`, rawHtml: '<div data-owner-placeholder>SV</div>' }], config.identity);
  assert.equal(trust.checks.namedOwner, true); assert.equal(trust.checks.ownerPortrait, true);
  assert.equal(measurementState("garbage"), "not_verifiable"); assert.equal(measurementState("public_detected"), "public_detected");
  const page = { key: "home", service: false, status: 200, analysis: rich };
  const score = scoreBenchmark({ weights: config.weights, pages: [page], crawl: { sitemapAvailable: true, robotsAvailable: true, localhostReferences: false, brokenLinks: [] }, pageSpeed: null, content: [content], trust, measurement: "not_verifiable" });
  assert.equal(score.categories.performance, null); assert.equal(score.categories.measurementAttribution, null); assert.ok(score.categories.accessibilityMobile > 0); assert.equal(score.unavailableWeight, 20);
  assert.equal(score.details.technicalSeo.length, 13); assert.equal(score.details.conversionUsability.length, 6);
});

test("freshness gate halts stale production and passes deployed Phase markers", () => {
  const home = { text: "Car Doc Subbu Veerappan since 2009", rawHtml: "<title>Auto Repair in Sterling Heights, MI | Car Doc</title>", title: "Auto Repair in STERLING HEIGHTS, MI | Car Doc", canonical: "https://cardoc-rho.vercel.app" };
  const brakes = { text: "Common questions Request Brake Service" };
  assert.equal(assertFreshDeployment(home, brakes, "https://cardoc-rho.vercel.app/services", "https://cardoc-rho.vercel.app"), true);
  assert.throws(() => assertFreshDeployment({ ...home, text: "Old" }, brakes, "ok", "https://cardoc-rho.vercel.app"), /Production deployment is not current enough/);
  assert.match(script, /freshness-error\.json/);
});

test("owner report includes transparency, old-site strengths, limitations, raw evidence, and future outcomes", () => {
  for (const phrase of ["Existing Site Strengths", "Methodology / Limitations", "Raw evidence references", "Future Business Outcomes", "Not yet enough production data", "Screenshot automation was unavailable"]) assert.match(script, new RegExp(phrase));
  assert.match(script, /timestamp = new Date\(\)\.toISOString\(\)/);
  assert.match(script, /rubricVersion/);
  assert.doesNotMatch(script, /PAGESPEED_API_KEY.*writeFile|api key.*output/i);
  assert.match(script, /error:/);
});

test("benchmark config is customer-specific while scoring engine contains no Car Doc URLs", () => {
  assert.equal(config.origins.new, "https://cardoc-rho.vercel.app");
  assert.equal(config.origins.old, "https://www.subbuscardoc.com");
  assert.doesNotMatch(engine, /cardoc-rho|subbuscardoc/);
  assert.match(script, /--new-site/); assert.match(script, /--old-site/); assert.match(script, /--config/); assert.match(script, /--output/);
  assert.match(script, /--reuse-pagespeed/);
});
