import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { leadLoader } from "./helpers/public-lead-loader.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [deploymentSource, pageSource, contentSource, attributionSource, importerSource] = await Promise.all([
  read("../plumworks-deployments/clients/cardoc/content/marketing-content.json"),
  read("src/app/(marketing)/services/[slug]/page.tsx"),
  read("src/lib/marketing-service-content.ts"),
  read("src/lib/marketing-attribution.ts"),
  read("scripts/import-marketing-content.mjs"),
]);
const document = JSON.parse(deploymentSource);
const services = document.services.filter((service) => service.active);
const activeSlugs = new Set(services.map((service) => service.slug));

test("all ten active services provide substantive, customer-configurable content", () => {
  assert.equal(services.length, 10);
  assert.equal(new Set(services.map((service) => service.content.intro)).size, 10);
  for (const service of services) {
    const content = service.content;
    assert.equal(content.version, 1, service.slug);
    assert.ok(content.heading.length >= 12, service.slug);
    assert.ok(content.intro.length >= 120, service.slug);
    assert.ok(content.signs.items.length >= 4, service.slug);
    assert.ok(content.services.items.length >= 4, service.slug);
    assert.ok(content.helpful.paragraphs.join(" ").length >= 250, service.slug);
    assert.ok(content.expectations.items.length >= 4, service.slug);
    assert.ok(content.faqs.length >= 3 && content.faqs.length <= 5, service.slug);
    assert.ok(content.faqs.every(({ question, answer }) => question.endsWith("?") && answer.length >= 60), service.slug);
    assert.match(content.cta.requestLabel, /^Request .*Service$|^Request Service$/, service.slug);
    assert.equal(content.cta.callLabel, "Call Car Doc", service.slug);
  }
});

test("related-service links are sparse, valid, active, and never self-referential", () => {
  for (const service of services) {
    assert.ok(service.content.related.length >= 2 && service.content.related.length <= 4, service.slug);
    for (const link of service.content.related) {
      assert.ok(activeSlugs.has(link.slug), `${service.slug} links to inactive ${link.slug}`);
      assert.notEqual(link.slug, service.slug);
    }
  }
});

test("long customer-facing paragraphs are not duplicated between service pages", () => {
  const occurrences = new Map();
  for (const service of services) {
    const paragraphs = [service.content.intro, ...service.content.helpful.paragraphs, service.content.expectations.intro, ...service.content.faqs.map(({ answer }) => answer), service.content.cta.body];
    for (const paragraph of paragraphs) {
      const normalized = paragraph.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (normalized.length < 100) continue;
      const owners = occurrences.get(normalized) ?? [];
      owners.push(service.slug);
      occurrences.set(normalized, owners);
    }
  }
  const duplicates = [...occurrences.entries()].filter(([, owners]) => new Set(owners).size > 1);
  assert.deepEqual(duplicates, []);
});

test("content avoids unsupported claims and unsafe universal guidance", () => {
  assert.doesNotMatch(deploymentSource, /\b(best mechanic|#1 shop|lowest prices|cheapest repair|same-day guaranteed|lifetime warranty|5-star shop|free diagnostics|free inspections|factory certified|all technicians ASE certified)\b/i);
  assert.doesNotMatch(deploymentSource, /every\s+3,?000\s+miles/i);
  assert.doesNotMatch(deploymentSource, /(?:code|P0420) (?:means|proves) (?:you need|the part)/i);
  assert.doesNotMatch(deploymentSource, /FAQPage|AggregateRating|reviewCount/);
  const diagnostic = services.find(({ slug }) => slug === "diagnostics").content;
  assert.match(JSON.stringify(diagnostic), /does not (?:automatically|always|by itself) identify/i);
  const maintenance = services.find(({ slug }) => slug === "scheduled-maintenance").content;
  assert.match(JSON.stringify(maintenance), /manufacturer|mileage|vehicle age|driving conditions|service history/i);
});

test("one generic semantic renderer preserves tracked conversion paths", () => {
  assert.equal((pageSource.match(/<h1\b/g) ?? []).length, 2, "one H1 per mutually exclusive structured/legacy renderer");
  assert.match(pageSource, /<ListSection section=\{content\.signs\}/);
  assert.match(pageSource, /<ListSection section=\{content\.services\}/);
  assert.match(pageSource, /content\.faqs\.map/);
  assert.match(pageSource, /description: service\.content\?\.intro \?\? service\.summary/);
  assert.match(pageSource, /AttributionLink href=\{`\/appointment\?service=\$\{service\.slug\}`\}/);
  assert.match(pageSource, /TrackedCallLink href=\{phoneHref\(shop\.phone\)\}/);
  assert.match(pageSource, /Talk with \{shop\.name\}/);
  assert.doesNotMatch(pageSource, /["']Car Doc["']|Sterling Heights/);
  for (const parameter of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]) assert.match(attributionSource, new RegExp(parameter));
  assert.match(contentSource, /decodeServiceDetail/);
  assert.match(importerSource, /encodeServiceContent\(item\.content/);
  assert.match(importerSource, /if \(dryRun\) \{ console\.log\("database writes performed: 0"\); \}/);
});


test("service CTAs follow the structured form contract even with old stored narrative copy", async () => {
  const jsx = (type, props) => ({ type, props });
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree.type === "function" ? nodes(tree.type(tree.props)) : [tree, ...nodes(tree.props?.children)];
  const service = structuredClone(services[0]);
  service.content.cta.heading = "Describe your concern through the form";
  service.content.cta.body = "Share the symptoms in the website message field";
  const load = leadLoader({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/link": { default: "a" }, "next/navigation": { notFound() { throw Error("not found"); } },
    "@/components/marketing/attribution-link": { AttributionLink: "a" },
    "@/components/marketing/tracked-call-link": { TrackedCallLink: "a" },
    "@/lib/marketing-content": { getMarketingServices: async () => [service] },
    "@/lib/marketing": { phoneHref: value => `tel:${value}` },
    "@/lib/marketing-seo": { getPublicSeoShop: async () => ({ name: "Synthetic Shop", city: "Example City", phone: "2025550123" }), canonicalUrl: () => null, safeJsonLd: JSON.stringify },
  });
  const rendered = nodes(await load("@/app/(marketing)/services/[slug]/page").default({ params: Promise.resolve({ slug: service.slug }) }));
  const text = rendered.flatMap(node => [node.props?.children].flat().filter(child => typeof child === "string")).join("\n");
  assert.ok(!text.includes(service.content.cta.heading));
  assert.ok(!text.includes(service.content.cta.body));
  assert.ok(text.includes(load("@/lib/marketing-requested-services").serviceRequestCopy));
  assert.ok(text.includes(service.content.helpful.paragraphs[0]), "educational diagnosis content is unchanged");
  assert.ok(text.includes(service.content.expectations.intro), "verbal follow-up information is unchanged");
  assert.ok(rendered.some(node => node.props?.href === "tel:2025550123"));
});
