import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inspectHtml, crawlCandidates, contentSignals, trustSignals, normalizePageSpeed, summarizePageSpeed, scoreBenchmark, assertFreshDeployment, measurementState, validateWeights, RUBRIC_VERSION, PRIVATE_PATHS } from "../src/lib/website-benchmark-core.mjs";

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const defaultConfig = resolve("../plumworks-deployments/clients/cardoc/benchmark/website-benchmark.json");
const configPath = resolve(arg("--config", defaultConfig));
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.rubricVersion !== RUBRIC_VERSION) throw new Error(`Unsupported rubric version: ${config.rubricVersion}`);
validateWeights(config.weights);
const origins = { new: arg("--new-site", config.origins.new).replace(/\/$/, ""), old: arg("--old-site", config.origins.old).replace(/\/$/, "") };
const timestamp = new Date().toISOString();
const day = timestamp.slice(0, 10);
const output = resolve(arg("--output", `artifacts/website-benchmark/${day}`));
const rawDirectory = join(output, "raw");
const reusePageSpeed = arg("--reuse-pagespeed", null);
const reusedPageSpeed = reusePageSpeed ? JSON.parse(await readFile(resolve(reusePageSpeed), "utf8")) : null;
await mkdir(rawDirectory, { recursive: true });
const userAgent = "PlumWorks-Website-Benchmark/1.0 (+public-read-only-audit)";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];

async function request(url, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) { await sleep(500 * attempt); continue; }
      return { status: response.status, url: response.url, headers: Object.fromEntries(response.headers), body: await response.text() };
    } catch (error) {
      if (attempt === attempts) return { status: 0, url, headers: {}, body: "", error: error instanceof Error ? error.message : String(error) };
      await sleep(500 * attempt);
    }
  }
}

async function fetchPage(url, key, service = false) {
  const response = await request(url);
  const analysis = inspectHtml(response.body, response.url || url);
  analysis.rawHtml = response.body;
  return { key, service, requestedUrl: url, finalUrl: response.url, status: response.status, error: response.error ?? null, analysis };
}

const freshnessHome = await fetchPage(`${origins.new}/`, "home");
const freshnessBrakes = await fetchPage(`${origins.new}${config.pages.brakes.new}`, "brakes", true);
const freshnessSitemap = await request(`${origins.new}/sitemap.xml`);
try { assertFreshDeployment(freshnessHome.analysis, freshnessBrakes.analysis, freshnessSitemap.body, origins.new); }
catch (error) { await writeFile(join(output, "freshness-error.json"), JSON.stringify({ timestamp, error: error.message }, null, 2)); console.error(error.message); process.exitCode = 2; process.exit(); }

async function limitedCrawl(origin) {
  const queue = [`${origin}/`], seen = new Set(), pages = [], brokenLinks = [], redirectChains = [];
  while (queue.length && pages.length < config.crawl.cap) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    const response = await request(url); const analysis = inspectHtml(response.body, response.url || url); analysis.rawHtml = response.body;
    pages.push({ requestedUrl: url, finalUrl: response.url, status: response.status, error: response.error ?? null, analysis });
    if (!response.status || response.status >= 400) brokenLinks.push({ url, status: response.status, error: response.error ?? null });
    if (response.url && response.url !== url) redirectChains.push({ from: url, to: response.url, hopsObserved: 1 });
    for (const candidate of crawlCandidates(analysis, origin, seen, origin === origins.new ? PRIVATE_PATHS : [])) if (queue.length + pages.length < config.crawl.cap * 2 && !queue.includes(candidate)) queue.push(candidate);
    await sleep(config.crawl.delayMs);
  }
  const titles = new Map(), descriptions = new Map();
  for (const page of pages) { if (page.analysis.title) titles.set(page.analysis.title, [...new Set([...(titles.get(page.analysis.title) ?? []), page.finalUrl])]); if (page.analysis.description) descriptions.set(page.analysis.description, [...new Set([...(descriptions.get(page.analysis.description) ?? []), page.finalUrl])]); }
  const sitemap = await request(`${origin}/sitemap.xml`), robots = await request(`${origin}/robots.txt`);
  return { cap: config.crawl.cap, delayMs: config.crawl.delayMs, pagesCrawled: pages.length, capReached: pages.length === config.crawl.cap, pages, brokenLinks, redirectChains, duplicateTitles: [...titles].filter(([, urls]) => urls.length > 1), duplicateDescriptions: [...descriptions].filter(([, urls]) => urls.length > 1), sitemapAvailable: sitemap.status >= 200 && sitemap.status < 400, robotsAvailable: robots.status >= 200 && robots.status < 400, localhostReferences: /localhost/i.test(sitemap.body + robots.body), sitemapStatus: sitemap.status, robotsStatus: robots.status };
}

async function pageSpeedRun(site, key, strategy, run) {
  const path = config.pages[key]?.[site]; if (!path) return null;
  const url = `${origins[site]}${path}`;
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url); endpoint.searchParams.set("strategy", strategy);
  for (const category of ["performance", "accessibility", "best-practices", "seo"]) endpoint.searchParams.append("category", category);
  if (process.env.PAGESPEED_API_KEY) endpoint.searchParams.set("key", process.env.PAGESPEED_API_KEY);
  const response = await request(endpoint.href, 3);
  let raw; try { raw = JSON.parse(response.body); } catch { raw = { error: { message: response.error ?? `PageSpeed HTTP ${response.status}` } }; }
  const safeRaw = structuredClone(raw); if (safeRaw?.id) delete safeRaw.id;
  await writeFile(join(rawDirectory, `pagespeed-${site}-${key}-${strategy}-${run}.json`), JSON.stringify(safeRaw, null, 2));
  return normalizePageSpeed(raw, { url, strategy, run, timestamp: new Date().toISOString() });
}

const representative = { new: [], old: [] };
for (const [key, mapping] of Object.entries(config.pages)) for (const site of ["new", "old"]) if (mapping[site]) representative[site].push(await fetchPage(`${origins[site]}${mapping[site]}`, key, Boolean(mapping.service)));

const crawls = { new: await limitedCrawl(origins.new), old: await limitedCrawl(origins.old) };
const pageSpeedRuns = reusedPageSpeed ? { new: reusedPageSpeed.new.runs, old: reusedPageSpeed.old.runs } : { new: [], old: [] };
if (!reusedPageSpeed) for (const site of ["new", "old"]) for (const key of config.pageSpeed.pages) for (const strategy of ["mobile", "desktop"]) for (let run = 1; run <= config.pageSpeed.runs; run++) { const result = await pageSpeedRun(site, key, strategy, run); if (result) pageSpeedRuns[site].push(result); }
const pageSpeedSummary = Object.fromEntries(["new", "old"].map((site) => [site, { aggregate: summarizePageSpeed(pageSpeedRuns[site]), runs: pageSpeedRuns[site] }]));

const evidence = {};
for (const site of ["new", "old"]) {
  const content = representative[site].filter((page) => page.service).map((page) => ({ key: page.key, ...contentSignals(page.analysis, { service: true, locality: config.identity.locality }) }));
  const trustPages = representative[site].map((page) => ({ ...page.analysis, rawHtml: page.analysis.rawHtml }));
  const trust = trustSignals(trustPages, config.identity);
  const measurementConfigured = measurementState(config.sourceEvidence[site].measurementAttribution);
  const measurement = measurementConfigured === "not_verifiable" && representative[site].some((page) => page.analysis.analyticsDetected) ? "public_detected" : measurementConfigured;
  evidence[site] = { content, trust, measurement, score: scoreBenchmark({ weights: config.weights, pages: representative[site], crawl: crawls[site], pageSpeed: pageSpeedSummary[site].aggregate, content, trust, measurement }) };
}

const technicalSeo = Object.fromEntries(["new", "old"].map((site) => [site, representative[site].map((page) => ({ key: page.key, status: page.status, finalUrl: page.finalUrl, https: page.analysis.https, lang: page.analysis.lang, viewport: page.analysis.viewport, title: page.analysis.title, description: page.analysis.description, canonical: page.analysis.canonical, canonicalCorrect: page.analysis.canonicalCorrect, h1: page.analysis.h1, schemaTypes: page.analysis.schemaTypes, openGraph: page.analysis.openGraph, twitter: page.analysis.twitter, wordCount: page.analysis.wordCount, analyticsDetected: page.analysis.analyticsDetected }))]));
await writeFile(join(output, "pagespeed-summary.json"), JSON.stringify({ timestamp, ...pageSpeedSummary }, null, 2));
await writeFile(join(output, "technical-seo.json"), JSON.stringify({ timestamp, ...technicalSeo }, null, 2));
await writeFile(join(output, "crawl-results.json"), JSON.stringify({ timestamp, new: { ...crawls.new, pages: crawls.new.pages.map(({ analysis, ...page }) => ({ ...page, analysis: { title: analysis.title, description: analysis.description, canonical: analysis.canonical, h1: analysis.h1 } })) }, old: { ...crawls.old, pages: crawls.old.pages.map(({ analysis, ...page }) => ({ ...page, analysis: { title: analysis.title, description: analysis.description, canonical: analysis.canonical, h1: analysis.h1 } })) } }, null, 2));
await writeFile(join(output, "content-trust.json"), JSON.stringify({ timestamp, new: { content: evidence.new.content, trust: evidence.new.trust }, old: { content: evidence.old.content, trust: evidence.old.trust } }, null, 2));
const scorecard = { timestamp, rubricVersion: config.rubricVersion, weights: config.weights, sites: { new: evidence.new.score, old: evidence.old.score }, measurementEvidence: { new: config.sourceEvidence.new, old: { ...config.sourceEvidence.old, publicAnalyticsDetected: representative.old.some((page) => page.analysis.analyticsDetected) } }, futureBusinessOutcomes: { status: "Not yet enough production data", metrics: ["visitors", "calls", "request-service submissions", "appointment requests", "directions clicks", "leads", "conversion rate", "source/medium", "jobs attributable to website", "revenue attributable to website"] } };
await writeFile(join(output, "scorecard.json"), JSON.stringify(scorecard, null, 2));
await writeFile(join(output, "raw", "representative-pages.json"), JSON.stringify(Object.fromEntries(["new", "old"].map((site) => [site, representative[site].map((page) => ({ key: page.key, requestedUrl: page.requestedUrl, finalUrl: page.finalUrl, status: page.status, error: page.error }))])), null, 2));

const label = (site) => config.displayNames[site];
const categoryRows = Object.keys(config.weights).map((key) => `| ${key.replace(/([A-Z])/g, " $1")} | ${evidence.new.score.categories[key] ?? "Unavailable"}/${config.weights[key]} | ${evidence.old.score.categories[key] ?? "Unavailable"}/${config.weights[key]} | scorecard.json |`).join("\n");
const existingStrengths = [crawls.old.pagesCrawled > crawls.new.pagesCrawled ? `The existing site exposes a larger public page footprint in the bounded crawl (${crawls.old.pagesCrawled} pages versus ${crawls.new.pagesCrawled}).` : null, evidence.old.trust.checks.genuineReviews ? "The existing site presents visible customer-review content." : null, evidence.old.score.categories.performance > evidence.new.score.categories.performance ? "The existing site had the stronger PageSpeed performance result in this run." : null].filter(Boolean);
const summary = `# Car Doc Website Benchmark\n\nBenchmark timestamp: ${timestamp}\n\nSites: ${label("new")} (${origins.new}) and ${label("old")} (${origins.old})\n\n## Executive Summary\n\nThis is a point-in-time readiness comparison. Category scores are evidence-based and unavailable values remain unavailable rather than becoming zero. Technical readiness does not establish current or future Google ranking.\n\n| Category | PlumWorks | Existing Site | Evidence |\n|---|---:|---:|---|\n${categoryRows}\n\nAvailable-point totals: PlumWorks ${evidence.new.score.totalAvailable}; Existing Site ${evidence.old.score.totalAvailable}. Unavailable weights: ${evidence.new.score.unavailableWeight} and ${evidence.old.score.unavailableWeight}, respectively.\n\n## Performance\n\nPageSpeed mobile and desktop results, individual runs, Lighthouse versions, metrics, warnings, and API errors are recorded in pagespeed-summary.json and raw/. A three-run median is used only where successful responses exist. INP is never inferred from lab data. Missing CrUX is labeled insufficient data.\n\n## Technical SEO\n\nRepresentative-page HTML findings are in technical-seo.json. The bounded crawl, duplicate metadata, redirects, and broken-link observations are in crawl-results.json.\n\n## Local SEO Readiness\n\nThis category measures visible NAP, hours, locality, schema, sitemap/indexability, directions, and business identity. It does not measure Google Business Profile or Maps ranking.\n\n## Content & Trust\n\nDeterministic service-content and visible trust criteria are itemized in content-trust.json. Word count is informational and does not earn points by itself.\n\n## Conversion\n\nThe audit checks visible call, request-service, contact, directions, service CTA, and expectation-setting paths. No form was submitted.\n\n## Measurement\n\nPlumWorks capabilities are labeled “Verified from PlumWorks source/tests.” Competitor backend capabilities remain “Not verifiable”; a public analytics tag, if detected, proves only public tag presence.\n\n## Existing Site Strengths\n\n${existingStrengths.length ? existingStrengths.map((item) => `- ${item}`).join("\n") : "- No evidence-supported category advantage was identified in this limited run; this is not a claim about business quality or historical search visibility."}\n- The older domain may have indexing history not captured by this benchmark.\n\n## PlumWorks Advantages\n\n- Source-tested lead attribution and click-to-call measurement are documented separately from public HTML.\n- The sampled service pages are evaluated against a transparent customer-usefulness rubric.\n- Private operational routes are explicitly excluded from the crawl.\n\n## Recommended Next Improvements\n\n1. Establish Search Console and Google Business Profile baselines after production traffic accumulates.\n2. Add only owner-approved reviews with verifiable attribution.\n3. Add optimized real shop photographs when supplied and approved.\n4. Repeat this benchmark on the same representative pages quarterly.\n\n## Future Business Outcomes\n\nNot yet enough production data. Future runs may add visitors, calls, requests, directions clicks, leads, conversion rate, jobs, and attributable revenue without changing the technical score retroactively.\n\n## Methodology / Limitations\n\n- Rubric: ${config.rubricVersion}; fixed weights total 100.\n- Crawl cap: ${config.crawl.cap} pages/site; delay: ${config.crawl.delayMs} ms.\n- Lighthouse/PageSpeed scores vary; these are lab measurements, not ranking scores.\n- CrUX field data may be absent for low-traffic URLs and is not penalized.\n- No competitor analytics, backend, Search Console, or Google Business Profile access was available.\n- Domain age and historical indexing are outside this technical score.\n- Screenshot automation was unavailable for this run.\n- Raw evidence references: raw/, pagespeed-summary.json, technical-seo.json, crawl-results.json, content-trust.json, scorecard.json.\n`;
await writeFile(join(output, "summary.md"), summary);
console.log(`benchmark output: ${output}`);
console.log(`rubric: ${config.rubricVersion}`);
console.log(`new available-point total: ${evidence.new.score.totalAvailable}`);
console.log(`old available-point total: ${evidence.old.score.totalAvailable}`);
if (errors.length) console.log(`captured errors: ${errors.length}`);
