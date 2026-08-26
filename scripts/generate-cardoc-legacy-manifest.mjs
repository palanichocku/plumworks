#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inventoryFile = resolve(process.argv[2] || "/private/tmp/cardoc-legacy-url-inventory.json");
const manifestFile = resolve(process.argv[3] || "../plumworks-deployments/clients/cardoc/seo/legacy-redirects.json");
const runtimeFile = resolve(process.argv[4] || "src/config/cardoc-legacy-redirects.json");
const inventory = JSON.parse(await readFile(inventoryFile, "utf8"));

const exact = new Map(Object.entries({
  "/index.php": ["/", "home/shop", "Legacy home entry point"],
  "/Sterling-Heights-auto-repairs.html": ["/about", "home/shop", "Closest current shop and owner page"],
  "/Sterling-Heights-suspension-repairs.html": ["/services/steering-suspension", "service", "Steering and suspension replacement"],
  "/Sterling-Heights-customer-service.html": ["/about", "home/shop", "Closest current shop approach page"],
  "/Sterling-Heights-code-of-ethics.html": ["/about", "home/shop", "Closest current shop approach page"],
  "/guarantee.html": ["/about", "home/shop", "Closest stable shop-information page without copying vendor claims"],
  "/site-map.html": ["/", "other", "Current site navigation replaces legacy site map"],
  "/Sterling-Heights-auto-repair-shop-location.html": ["/contact", "forms/contact", "Current shop location and contact page"],
  "/Sterling-Heights-auto-repair-shop.php": ["/contact", "forms/contact", "Current shop contact page"],
  "/Sterling-Heights-ask-an-expert.php": ["/contact", "forms/contact", "Current contact workflow"],
  "/Sterling-Heights-customer-survey.php": ["/contact", "forms/contact", "Current contact workflow; legacy survey content is not copied"],
  "/Sterling-Heights-review-our-service.php": ["/contact", "forms/contact", "Current contact workflow; no unapproved reviews"],
  "/Sterling-Heights-review-our-service-contact.php": ["/contact", "forms/contact", "Current contact workflow"],
  "/review-our-service.php": ["/contact", "forms/contact", "Current contact workflow; no unapproved reviews"],
  "/review-our-service-contact.php": ["/contact", "forms/contact", "Current contact workflow"],
  "/Sterling-Heights-appointment-request.php": ["/appointment", "forms/contact", "Current service-request workflow"],
  "/Sterling-Heights-auto-repair-careers.php": ["/contact", "forms/contact", "Current contact page for shop inquiries"],
  "/referral.php": ["/contact", "forms/contact", "Current contact workflow; legacy referral content is not copied"],
  "/thankyou.html": ["/contact", "forms/contact", "Legacy form completion page has no standalone replacement"],
  "/defaults/files/DrivabilityForm.pdf": ["/drop-off", "forms/contact", "Current drop-off information workflow"],
  "/privacy-policy.html": ["/privacy", "privacy", "Current privacy policy"],
  "/Sterling-Heights-testimonials.html": ["/about", "reviews/photos/coupons", "No approved reviews; use stable shop page"],
  "/Sterling-Heights-slideshow.html": ["/about", "reviews/photos/coupons", "No approved gallery; use stable shop page"],
  "/coupons.html": ["/", "reviews/photos/coupons", "No approved current coupons"],
  "/Car-Doc-auto-service-tips.html": ["/services/scheduled-maintenance", "repair tips", "Closest current maintenance guidance"],
  "/auto_repair_blog.html": ["/services", "repair tips", "No vendor articles copied; current service index"],
  "/Sterling-Heights-when-accidents-happen.html": ["/contact", "other", "No collision-service claim; contact shop for guidance"],
  "/Sterling-Heights-insurance-questions.html": ["/contact", "other", "No insurance-service claim; contact shop for guidance"],
  "/Sterling-Heights-tire-selector.php": ["/services", "service", "No current tire-specific route"],
  "/best-tire-shop-in-Sterling-Heights.html": ["/services", "service", "No current tire-specific route"],
}));

const cities = new Set(["/Clinton-Township.html", "/Detroit.html", "/Macomb-Township.html", "/Rochester-Hills.html", "/Royal-Oak-.html", "/St-Clair-Shores.html", "/Troy.html", "/Warren.html"]);
const makePattern = /(?:-repairs\.html|auto-repair-in-Sterling-Heights\.html)$/;
const broadVehiclePattern = /(?:asian-vehicles|domestic-auto-repair|import-foreign-auto-repair|electric-hybrid)/;

function decision(source) {
  if (source === "/") return { source, decision: "retain", destination: null, status: null, category: "home/shop", reason: "Current home route remains the canonical home route" };
  if (exact.has(source)) { const [destination, category, reason] = exact.get(source); return { source, decision: "redirect", destination, status: 301, category, reason }; }
  if (cities.has(source)) return { source, decision: "redirect", destination: "/contact", status: 301, category: "city/location", reason: "Current Sterling Heights shop location" };
  if (makePattern.test(source) || broadVehiclePattern.test(source)) return { source, decision: "redirect", destination: "/services", status: 301, category: "manufacturer/make", reason: "No current make-specific route; use honest service index" };
  const rules = [
    [/AC-|auto-ac|car-AC/i, "/services/ac-heating-cooling", "A/C, heating and cooling replacement"],
    [/brakes/i, "/services/brakes", "Brake-service replacement"],
    [/suspension/i, "/services/steering-suspension", "Steering and suspension replacement"],
    [/transmission/i, "/services/transmission-clutch", "Transmission and clutch replacement"],
    [/(undercar|4x4)/i, "/services/undercar-service", "Closest undercar and drivetrain replacement"],
    [/auto-electrical/i, "/services/battery-electrical", "Battery and electrical replacement"],
    [/(auto-electronics|broken-car)/i, "/services/diagnostics", "Diagnostic-service replacement"],
    [/engine/i, "/services/engine-repair", "Engine-service replacement"],
    [/(maintenance|helpful-info)/i, "/services/scheduled-maintenance", "Scheduled-maintenance replacement"],
    [/(auto-service-repair|auto-repair-services|auto-services|expired-warranty-care)/i, "/services", "Current service index"],
  ];
  for (const [pattern, destination, reason] of rules) if (pattern.test(source)) return { source, decision: "redirect", destination, status: 301, category: "service", reason };
  throw new Error(`Unmapped eligible legacy URL: ${source}`);
}

const eligible = inventory.records.filter((row) => row.liveStatus === 200 && (row.contentType.includes("text/html") || row.contentType.includes("application/pdf")));
const decisions = eligible.map((row) => decision(row.source)).sort((a, b) => a.source.localeCompare(b.source));
const redirects = decisions.filter((row) => row.decision === "redirect");
const manifest = { formatVersion: 1, customer: "cardoc", legacyHosts: ["subbuscardoc.com", "www.subbuscardoc.com"], canonicalHostAfterCutover: "www.subbuscardoc.com", redirects };
const audit = { ...inventory, decisions };
const groups = Map.groupBy(redirects, (row) => row.category);
const reportLines = ["# Car Doc legacy redirect audit", "", `Generated: ${inventory.generatedAt}`, "", `- Legacy sitemap URLs: ${inventory.sources.sitemapUrlCount}`, `- Total inventoried URLs: ${inventory.records.length}`, `- Eligible live HTML/PHP/PDF URLs: ${eligible.length}`, `- Explicit 301 redirects: ${redirects.length}`, `- Retained routes: ${decisions.length - redirects.length}`, `- Unmapped eligible routes: 0`, ""];
for (const category of [...groups.keys()].sort()) {
  reportLines.push(`## ${category}`, "", "| Source | Destination |", "| --- | --- |");
  for (const row of groups.get(category)) reportLines.push(`| \`${row.source}\` | \`${row.destination}\` |`);
  reportLines.push("");
}
await mkdir(dirname(manifestFile), { recursive: true });
await mkdir(dirname(runtimeFile), { recursive: true });
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(dirname(manifestFile), "legacy-url-inventory.json"), `${JSON.stringify(audit, null, 2)}\n`);
await writeFile(resolve(dirname(manifestFile), "legacy-redirect-audit.md"), `${reportLines.join("\n")}\n`);
await writeFile(runtimeFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ eligible: eligible.length, redirects: redirects.length, retained: decisions.length - redirects.length, manifestFile, runtimeFile }, null, 2));
