#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const deploymentRoot = resolve(process.argv[2] || "../plumworks-deployments");
const manifest = JSON.parse(await readFile(resolve(deploymentRoot, "clients/cardoc/seo/legacy-redirects.json"), "utf8"));
const inventory = JSON.parse(await readFile(resolve(deploymentRoot, "clients/cardoc/seo/legacy-url-inventory.json"), "utf8"));
const runtime = JSON.parse(await readFile(resolve("src/config/cardoc-legacy-redirects.json"), "utf8"));
const publicPaths = new Set(["/", "/about", "/services", "/contact", "/appointment", "/drop-off", "/privacy", "/services/diagnostics", "/services/oil-change", "/services/brakes", "/services/scheduled-maintenance", "/services/ac-heating-cooling", "/services/battery-electrical", "/services/steering-suspension", "/services/transmission-clutch", "/services/engine-repair", "/services/undercar-service"]);
const emptyOptional = new Set(["/reviews", "/photos", "/coupons"]);

assert.deepEqual(runtime, manifest, "runtime redirect copy must match the customer manifest");
assert.deepEqual(manifest.legacyHosts, ["subbuscardoc.com", "www.subbuscardoc.com"]);
const sources = manifest.redirects.map((row) => row.source);
assert.equal(new Set(sources).size, sources.length, "duplicate source path");
const normalized = sources.map((source) => decodeURIComponent(source).toLowerCase());
assert.equal(new Set(normalized).size, normalized.length, "conflicting normalized source path");
const sourceSet = new Set(sources);
for (const row of manifest.redirects) {
  assert.equal(row.status, 301, `${row.source}: status must be 301`);
  assert.ok(publicPaths.has(row.destination), `${row.source}: unknown public destination ${row.destination}`);
  assert.ok(!emptyOptional.has(row.destination), `${row.source}: empty optional destination`);
  assert.ok(!row.destination.startsWith("/admin") && !row.destination.startsWith("/dashboard"), `${row.source}: private destination`);
  assert.notEqual(row.source, row.destination, `${row.source}: self redirect`);
  assert.ok(!sourceSet.has(row.destination), `${row.source}: redirect chain`);
  assert.doesNotMatch(row.destination, /\.(?:html|php)$/i, `${row.source}: legacy destination`);
}
const eligible = inventory.records.filter((row) => row.liveStatus === 200 && (row.contentType.includes("text/html") || row.contentType.includes("application/pdf")));
const decisions = new Map(inventory.decisions.map((row) => [row.source, row]));
for (const row of eligible) assert.ok(decisions.has(row.source), `${row.source}: missing inventory decision`);
assert.equal(eligible.length, decisions.size, "decision count differs from eligible inventory");
assert.equal([...decisions.values()].filter((row) => row.decision === "redirect").length, manifest.redirects.length);
for (const [source, destination] of Object.entries({ "/Sterling-Heights-auto-brakes.html": "/services/brakes", "/Sterling-Heights-auto-electronics.html": "/services/diagnostics", "/Sterling-Heights-suspension-repairs.html": "/services/steering-suspension", "/Sterling-Heights-transmission-repair.html": "/services/transmission-clutch", "/Sterling-Heights-testimonials.html": "/about", "/Sterling-Heights-slideshow.html": "/about", "/coupons.html": "/" })) assert.equal(manifest.redirects.find((row) => row.source === source)?.destination, destination, `${source}: required mapping`);

console.log(JSON.stringify({ result: "PASS", sitemapUrls: inventory.sources.sitemapUrlCount, inventoriedUrls: inventory.records.length, eligiblePublicUrls: eligible.length, redirects: manifest.redirects.length, retained: [...decisions.values()].filter((row) => row.decision === "retain").length, unmapped: eligible.filter((row) => !decisions.has(row.source)).length }, null, 2));
