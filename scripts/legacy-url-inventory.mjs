import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { inspectHtml } from "../src/lib/website-benchmark-core.mjs";

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const origin = new URL(argument("--origin", "https://www.subbuscardoc.com"));
const output = resolve(argument("--output", "artifacts/legacy-url-inventory.json"));
const cap = Number(argument("--cap", "300"));
const delayMs = Number(argument("--delay-ms", "150"));
if (origin.protocol !== "https:" || !origin.hostname || !Number.isInteger(cap) || cap < 1 || cap > 1000 || !Number.isInteger(delayMs) || delayMs < 0) throw new Error("Invalid inventory arguments.");

const userAgent = "PlumWorks-Legacy-URL-Inventory/1.0 (+public-read-only-migration-audit)";
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const knownPublicSeeds = ["/defaults/files/DrivabilityForm.pdf"];
async function request(url) {
  try {
    const response = await fetch(url, { headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null;
    const body = contentType?.includes("html") || contentType?.includes("xml") || contentType?.startsWith("text/") ? await response.text() : "";
    return { status: response.status, finalUrl: response.url, contentType, body };
  } catch (error) {
    return { status: 0, finalUrl: url, contentType: null, body: "", error: error instanceof Error ? error.message : String(error) };
  }
}
function normalize(value) {
  const url = new URL(value, origin);
  url.hash = "";
  url.search = "";
  return url.origin === origin.origin ? url.href : null;
}
function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => normalize(match[1])).filter(Boolean);
}

const sitemap = await request(new URL("/sitemap.xml", origin));
const robots = await request(new URL("/robots.txt", origin));
const fromSitemap = sitemapUrls(sitemap.body);
const discovery = new Map();
const enqueue = (url, source) => {
  const normalized = normalize(url);
  if (!normalized) return;
  const sources = discovery.get(normalized) ?? new Set();
  sources.add(source);
  discovery.set(normalized, sources);
};
enqueue(new URL("/", origin), "crawl-root");
for (const url of fromSitemap) enqueue(url, "sitemap");
for (const path of knownPublicSeeds) enqueue(new URL(path, origin), "reviewed-public-seed");
for (const match of robots.body.matchAll(/(?:Sitemap|Allow):\s*(\S+)/gi)) enqueue(match[1], "robots");

const queue = [...discovery.keys()];
const visited = new Set();
const records = [];
while (queue.length && visited.size < cap) {
  const requestedUrl = queue.shift();
  if (visited.has(requestedUrl)) continue;
  visited.add(requestedUrl);
  const response = await request(requestedUrl);
  const requested = new URL(requestedUrl);
  let canonical = null;
  if (response.contentType?.includes("html")) {
    const analysis = inspectHtml(response.body, response.finalUrl || requestedUrl);
    canonical = analysis.canonical ? normalize(analysis.canonical) : null;
    for (const link of analysis.links) {
      const normalized = normalize(link);
      if (!normalized) continue;
      enqueue(normalized, `crawl:${requested.pathname}`);
      if (!visited.has(normalized) && !queue.includes(normalized)) queue.push(normalized);
    }
    for (const tag of response.body.match(/<(?:form|iframe|object)\b[^>]*>/gi) ?? []) {
      const value = tag.match(/\b(?:action|src|data)\s*=\s*["']([^"']+)["']/i)?.[1];
      const normalized = value ? normalize(value) : null;
      if (!normalized) continue;
      enqueue(normalized, `embedded:${requested.pathname}`);
      if (!visited.has(normalized) && !queue.includes(normalized)) queue.push(normalized);
    }
  }
  records.push({
    source: requested.pathname,
    liveStatus: response.status,
    contentType: response.contentType,
    discoveredFrom: [...(discovery.get(requestedUrl) ?? [])].sort(),
    finalPath: new URL(response.finalUrl || requestedUrl).pathname,
    canonicalPath: canonical ? new URL(canonical).pathname : null,
    error: response.error ?? null,
  });
  if (queue.length) await sleep(delayMs);
}
records.sort((left, right) => left.source.localeCompare(right.source));
const inventory = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  origin: origin.origin,
  limits: { cap, delayMs, capReached: visited.size === cap },
  sources: { sitemapStatus: sitemap.status, robotsStatus: robots.status, sitemapUrlCount: new Set(fromSitemap.map((url) => new URL(url).pathname)).size },
  records,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(JSON.stringify({ output, sitemapUrls: inventory.sources.sitemapUrlCount, inventoried: records.length, capReached: inventory.limits.capReached }));
