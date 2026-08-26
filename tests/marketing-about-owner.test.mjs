import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const privateRoot = new URL("../../plumworks-deployments/", import.meta.url);
const [aboutPage, portrait, contentLoader, previewSource, importer, content] = await Promise.all([
  readFile(new URL("src/app/(marketing)/about/page.tsx", root), "utf8"),
  readFile(new URL("src/components/marketing/owner-portrait.tsx", root), "utf8"),
  readFile(new URL("src/lib/marketing-content.ts", root), "utf8"),
  readFile(new URL("src/lib/marketing-content-preview.ts", root), "utf8"),
  readFile(new URL("scripts/import-marketing-content.mjs", root), "utf8"),
  readFile(new URL("clients/cardoc/content/marketing-content.json", privateRoot), "utf8").then(JSON.parse),
]);

test("Car Doc config contains the complete optional owner content without changing existing About content", () => {
  assert.deepEqual(content.aboutOwner, {
    heading: "Meet the Owner",
    name: "Subbu Veerappan",
    role: "Owner and ASE Master Technician",
    biography: "Subbu Veerappan is the owner of Car Doc, serving drivers in Sterling Heights and nearby communities. Car Doc has provided automotive maintenance and repair services in the area since 2009.\n\nSubbu believes customers should receive clear explanations and practical recommendations before repair work begins. Whether the vehicle needs routine maintenance, diagnostics, or a more involved repair, his focus is on helping customers understand their options and keeping their vehicles safe and reliable.",
    homepageSummary: "Subbu leads Car Doc with a practical approach: understand the concern, evaluate the vehicle, explain the findings, and let the customer review the recommendation before work proceeds.",
    historyLabel: "Serving the Sterling Heights area since 2009",
    principles: [
      "Listen to the customer's concern before evaluating the vehicle.",
      "Explain findings and practical recommendations in understandable terms.",
      "Discuss the options and receive approval before repair work proceeds.",
    ],
  });
  const about = content.pages.find((page) => page.slug === "about");
  assert.deepEqual(about, {
    slug: "about", eyebrow: "About Car Doc", title: "Straightforward help with vehicle concerns",
    description: "Car Doc provides automotive maintenance, diagnostics, and repair in Sterling Heights.",
    body: "Start by explaining the maintenance need, warning light, sound, or change you have noticed. The shop can evaluate the concern, explain the recommendation in understandable terms, and let you review the work before it proceeds.", active: true,
  });
});

test("owner portrait is optional and uses a neutral initials placeholder", () => {
  assert.equal(content.aboutOwner.imageUrl, undefined);
  assert.match(portrait, /data-owner-placeholder/);
  assert.match(portrait, /initials\(name\)/);
  assert.match(portrait, /if \(imageUrl\)/);
});

test("About renders the optional owner after the unchanged existing content with responsive accessible image markup", () => {
  assert.match(aboutPage, /getMarketingAboutOwner\(\)/);
  assert.ok(aboutPage.indexOf("How repair decisions are approached") < aboutPage.indexOf("owner \? <section"));
  assert.match(aboutPage, /owner \? <section[\s\S]*<h2[\s\S]*owner\.heading[\s\S]*<h3[\s\S]*owner\.name[\s\S]*owner\.role[\s\S]*owner\.biography/);
  assert.match(aboutPage, /<OwnerPortrait name=\{owner\.name\}/);
  assert.match(aboutPage, /md:grid-cols-\[240px_minmax\(0,1fr\)\]/);
  assert.match(aboutPage, /min-w-0/);
  assert.match(aboutPage, /: null\}/);
});

test("owner content uses existing MarketingPage storage and remains absent without configuration", () => {
  assert.match(importer, /slug: "about-owner"/);
  assert.match(importer, /if \(owner\) pages\.push\(owner\)/);
  assert.match(contentLoader, /slug: "about-owner", active: true/);
  assert.match(contentLoader, /if \(preview\) return preview\.aboutOwner/);
  assert.match(contentLoader, /return null/);
  assert.match(previewSource, /const rawOwner = document\.aboutOwner == null \? null/);
  assert.match(previewSource, /aboutOwner\.imageUrl must use a local client asset path/);
  assert.doesNotMatch(contentLoader, /Subbu|Car Doc|subbu-veerappan/);
});

test("shared generic fallbacks and unrelated public routes are untouched", () => {
  assert.doesNotMatch(contentLoader.slice(contentLoader.indexOf("fallbackMarketingSettings"), contentLoader.indexOf("export const getMarketingSettings")), /owner|Subbu|Car Doc/i);
  assert.doesNotMatch(aboutPage, /appointment|drop-off|privacy|reviews|coupons|photos/);
});
