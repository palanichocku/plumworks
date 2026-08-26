export const RUBRIC_VERSION = "cardoc-website-benchmark-v1";
export const PRIVATE_PATHS = [/^\/admin(?:\/|$)/, /^\/dashboard/, /^\/customers/, /^\/vehicles/, /^\/repair-orders/, /^\/invoices/, /^\/payments/, /^\/reports/, /^\/accounts-receivable/, /^\/open-orders/, /^\/settings/, /^\/login/];
export const RUBRIC_ITEMS = {
  technicalSeo: ["sampled pages return success", "HTTPS", "titles present", "sampled titles unique", "descriptions present", "canonicals present", "canonicals clean and self-referencing", "one H1", "structured data present", "sitemap available", "robots available", "no localhost in sitemap/robots", "no broken links in bounded crawl"],
  conversionUsability: ["homepage telephone link", "request-service path", "contact route", "directions path", "service-page CTA", "request confirmation expectations"],
  localSeoReadiness: ["street address", "phone", "hours", "Sterling Heights relevance", "AutoRepair/LocalBusiness schema", "HTTPS", "sitemap", "directions", "owner/business identity"],
};

export function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

export function normalizePageSpeed(raw, { url, strategy, run, timestamp = new Date().toISOString() }) {
  if (!raw?.lighthouseResult) return { url, strategy, run, timestamp, error: raw?.error?.message ?? "PageSpeed response contained no Lighthouse result" };
  const lighthouse = raw.lighthouseResult;
  const audit = (id) => lighthouse.audits?.[id];
  const numeric = (id) => Number.isFinite(audit(id)?.numericValue) ? audit(id).numericValue : null;
  const field = raw.loadingExperience?.metrics ?? null;
  return {
    url, strategy, run, timestamp, lighthouseVersion: lighthouse.lighthouseVersion ?? null,
    categories: Object.fromEntries(["performance", "accessibility", "best-practices", "seo"].map((key) => [key, Number.isFinite(lighthouse.categories?.[key]?.score) ? Math.round(lighthouse.categories[key].score * 100) : null])),
    metrics: { lcpMs: numeric("largest-contentful-paint"), cls: numeric("cumulative-layout-shift"), tbtMs: numeric("total-blocking-time"), speedIndexMs: numeric("speed-index"), fcpMs: numeric("first-contentful-paint"), inpMs: null },
    fieldData: field ? { scope: "url", lcp: field.LARGEST_CONTENTFUL_PAINT_MS ?? null, cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ?? null, inp: field.INTERACTION_TO_NEXT_PAINT ?? null } : { status: "insufficient_data" },
    warnings: lighthouse.runWarnings ?? [],
  };
}

export function summarizePageSpeed(runs) {
  const successful = runs.filter((run) => !run.error);
  const byStrategy = {};
  for (const strategy of ["mobile", "desktop"]) {
    const selected = successful.filter((run) => run.strategy === strategy);
    byStrategy[strategy] = {
      successfulRuns: selected.length,
      categories: Object.fromEntries(["performance", "accessibility", "best-practices", "seo"].map((key) => [key, median(selected.map((run) => run.categories[key]))])),
      metrics: Object.fromEntries(["lcpMs", "cls", "tbtMs", "speedIndexMs", "fcpMs"].map((key) => [key, median(selected.map((run) => run.metrics[key]))])),
      inpMs: null,
    };
  }
  return byStrategy;
}

const decode = (value = "") => value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
const meta = (html, key, value) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) if (attribute(tag, key)?.toLowerCase() === value.toLowerCase()) return attribute(tag, "content");
  return null;
};

export function inspectHtml(html, url) {
  const base = new URL(url);
  const title = decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const canonicalTag = (html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i) ?? html.match(/<link\b[^>]*href=["'][^"']+["'][^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i))?.[0];
  const canonical = canonicalTag ? attribute(canonicalTag, "href") : null;
  const jsonLd = (html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? []).map((script) => decode(script.replace(/^<script\b[^>]*>|<\/script>$/gi, "")));
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => decode(match[1]));
  const links = [];
  for (const tag of html.match(/<a\b[^>]*href=["'][^"']*["'][^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    try { if (href && !href.startsWith("#") && !/^(mailto|tel|javascript):/i.test(href)) links.push(new URL(href, base).href); } catch {}
  }
  const visibleText = decode(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "));
  return {
    url, https: base.protocol === "https:", lang: html.match(/<html\b[^>]*lang=["']([^"']+)["']/i)?.[1] ?? null,
    viewport: meta(html, "name", "viewport"), title, description: meta(html, "name", "description"), canonical,
    canonicalCorrect: canonical ? new URL(canonical, base).pathname === base.pathname && !new URL(canonical, base).search : false,
    h1: headings, jsonLd, schemaTypes: [...new Set(jsonLd.flatMap((value) => [...value.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((match) => match[1])))],
    openGraph: { title: meta(html, "property", "og:title"), description: meta(html, "property", "og:description"), url: meta(html, "property", "og:url") },
    twitter: { card: meta(html, "name", "twitter:card"), title: meta(html, "name", "twitter:title"), description: meta(html, "name", "twitter:description") },
    links: [...new Set(links)], hasTelephoneLink: /<a\b[^>]*href=["']tel:/i.test(html), wordCount: visibleText ? visibleText.split(/\s+/).length : 0, text: visibleText,
    analyticsDetected: /googletagmanager|google-analytics|gtag\s*\(/i.test(html),
  };
}

export function crawlCandidates(page, origin, seen, privatePatterns = PRIVATE_PATHS) {
  const expected = new URL(origin).origin;
  return page.links.filter((href) => { const url = new URL(href); return url.origin === expected && !privatePatterns.some((pattern) => pattern.test(url.pathname)) && !seen.has(url.href.split("#")[0]); }).map((href) => href.split("#")[0]);
}

export function contentSignals(page, { service = false, locality = "" } = {}) {
  const text = page.text.toLowerCase();
  const relatedServiceLinks = page.links.filter((link) => new URL(link).pathname.includes("/services/")).length;
  const checks = service ? {
    serviceH1: page.h1.length === 1,
    introduction: page.wordCount >= 180,
    symptoms: /signs|reasons|symptoms|warning|noise|vibration|concern/.test(text),
    scope: /what .* can|inspect|evaluate|service/.test(text),
    education: /helpful|why |does not|not always|depends/.test(text),
    process: /what to expect|approve|authorization/.test(text),
    faq: /common questions|frequently asked|\?/.test(text),
    local: locality ? text.includes(locality.toLowerCase()) : false,
    relatedLinks: relatedServiceLinks >= 1,
    cta: /request service|call/.test(text),
  } : {};
  return { checks, passed: Object.values(checks).filter(Boolean).length, possible: Object.keys(checks).length, wordCount: page.wordCount };
}

export function trustSignals(pages, identity) {
  const text = pages.map((page) => page.text).join(" ").toLowerCase();
  const compactPhone = text.replace(/\D/g, "");
  const checks = {
    namedOwner: text.includes(identity.owner.toLowerCase()), ownerRole: text.includes("owner"), scopedCredential: text.includes(identity.ownerRole.toLowerCase()),
    ownerPortrait: pages.some((page) => /data-owner-placeholder|owner[^<]{0,30}(jpg|webp|png)/i.test(page.rawHtml ?? "")),
    address: text.includes(identity.streetAddress.toLowerCase()), phone: compactPhone.includes(identity.phone.replace(/\D/g, "")),
    hours: /monday|friday|saturday|hours/.test(text), history: text.includes(identity.history.toLowerCase()),
    approvalProcess: /approve|authorization|before.*work/.test(text), genuineReviews: /customer review/.test(text) && /blockquote/.test(pages.map((page) => page.rawHtml ?? "").join("")),
    realShopPhotos: pages.some((page) => /shop photo|gallery/.test(page.text.toLowerCase()) && /<img/i.test(page.rawHtml ?? "")),
  };
  return { checks, passed: Object.values(checks).filter(Boolean).length, possible: Object.keys(checks).length };
}

export function measurementState(value) { return ["verified", "public_detected", "not_verifiable"].includes(value) ? value : "not_verifiable"; }
export function validateWeights(weights) { const total = Object.values(weights).reduce((sum, value) => sum + value, 0); if (total !== 100) throw new Error(`Benchmark weights must total 100; received ${total}.`); return total; }
export function proportionalScore(passed, possible, weight) { return possible ? Math.round((passed / possible) * weight * 10) / 10 : null; }

export function scoreBenchmark({ weights, pages, crawl, pageSpeed, content, trust, measurement }) {
  validateWeights(weights);
  const all = pages;
  const techChecks = [all.every((p) => p.status >= 200 && p.status < 400), all.every((p) => p.analysis.https), all.every((p) => p.analysis.title), new Set(all.map((p) => p.analysis.title)).size === all.length, all.every((p) => p.analysis.description), all.every((p) => p.analysis.canonical), all.every((p) => p.analysis.canonicalCorrect), all.every((p) => p.analysis.h1.length === 1), all.some((p) => p.analysis.schemaTypes.length), crawl.sitemapAvailable, crawl.robotsAvailable, !crawl.localhostReferences, crawl.brokenLinks.length === 0];
  const home = all.find((p) => p.key === "home")?.analysis;
  const conversionChecks = [home?.hasTelephoneLink ?? false, /request service|appointment/.test(home?.text.toLowerCase() ?? ""), all.some((p) => p.key === "contact" && p.status < 400), all.some((p) => /directions|map/.test(p.analysis.text.toLowerCase())), all.filter((p) => p.service).every((p) => /request|call/.test(p.analysis.text.toLowerCase())), /not.*confirm|not automatically confirmed/.test(home?.text.toLowerCase() ?? "")];
  const localChecks = [trust.checks.address, trust.checks.phone, trust.checks.hours, all.some((p) => p.analysis.text.includes("Sterling Heights")), all.some((p) => p.analysis.schemaTypes.some((t) => ["AutoRepair", "LocalBusiness"].includes(t))), all.every((p) => p.analysis.https), crawl.sitemapAvailable, conversionChecks[3], trust.checks.namedOwner];
  const lighthouse = pageSpeed ? [pageSpeed.mobile?.categories, pageSpeed.desktop?.categories].filter(Boolean) : [];
  const performanceMedian = lighthouse.length ? median(lighthouse.map((item) => item.performance)) : null;
  const accessibilityMedian = lighthouse.length ? median(lighthouse.map((item) => item.accessibility)) : null;
  const performanceScore = performanceMedian === null ? null : performanceMedian / 100 * weights.performance;
  const accessibilityScore = accessibilityMedian === null ? proportionalScore(all.filter((p) => p.analysis.lang && p.analysis.viewport && p.analysis.h1.length === 1).length, all.length, weights.accessibilityMobile) : accessibilityMedian / 100 * weights.accessibilityMobile;
  const contentPossible = content.reduce((sum, item) => sum + item.possible, 0) + trust.possible;
  const contentPassed = content.reduce((sum, item) => sum + item.passed, 0) + trust.passed;
  const categories = {
    conversionUsability: proportionalScore(conversionChecks.filter(Boolean).length, conversionChecks.length, weights.conversionUsability),
    localSeoReadiness: proportionalScore(localChecks.filter(Boolean).length, localChecks.length, weights.localSeoReadiness),
    technicalSeo: proportionalScore(techChecks.filter(Boolean).length, techChecks.length, weights.technicalSeo),
    performance: performanceScore === null ? null : Math.round(performanceScore * 10) / 10,
    contentTrust: proportionalScore(contentPassed, contentPossible, weights.contentTrust),
    accessibilityMobile: accessibilityScore === null ? null : Math.round(accessibilityScore * 10) / 10,
    measurementAttribution: measurement === "verified" ? weights.measurementAttribution : measurement === "public_detected" ? weights.measurementAttribution / 2 : null,
  };
  const itemize = (names, values) => names.map((criterion, index) => ({ criterion, passed: values[index] }));
  return { categories, totalAvailable: Math.round(Object.values(categories).filter(Number.isFinite).reduce((a, b) => a + b, 0) * 10) / 10, unavailableWeight: Object.entries(categories).filter(([, value]) => value === null).reduce((sum, [key]) => sum + weights[key], 0), details: { technicalSeo: itemize(RUBRIC_ITEMS.technicalSeo, techChecks), conversionUsability: itemize(RUBRIC_ITEMS.conversionUsability, conversionChecks), localSeoReadiness: itemize(RUBRIC_ITEMS.localSeoReadiness, localChecks), contentTrust: { method: "passed visible content/trust checks divided by applicable checks", passed: contentPassed, possible: contentPossible }, accessibilityMobile: { method: accessibilityMedian === null ? "static HTML language, viewport, and H1 checks; Lighthouse unavailable" : "median Lighthouse accessibility score" }, performance: { method: performanceMedian === null ? "unavailable: no successful PageSpeed run" : "median Lighthouse performance score" }, measurementAttribution: { state: measurement } } };
}

export function assertFreshDeployment(home, brakes, sitemap, expectedOrigin) {
  const failures = [];
  if (!/Car Doc/.test(home.text) || /<title>[^<]*CAR DOC LLC/i.test(home.rawHtml ?? "")) failures.push("public brand");
  if (!/Subbu Veerappan/i.test(home.text) || !/since 2009/i.test(home.text)) failures.push("Phase 3A owner trust");
  if (!/Common questions/i.test(brakes.text) || !/Request Brake Service/i.test(brakes.text)) failures.push("Phase 2 brake content");
  if (home.title.toLowerCase() !== "auto repair in sterling heights, mi | car doc".toLowerCase()) failures.push("Phase 1 homepage title");
  if (home.canonical !== `${expectedOrigin}/` && home.canonical !== expectedOrigin) failures.push("canonical");
  if (/localhost/i.test(sitemap)) failures.push("sitemap origin");
  if (failures.length) throw new Error(`Production deployment is not current enough for a fair comparison. Missing: ${failures.join(", ")}.`);
  return true;
}
