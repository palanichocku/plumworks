import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const privateRoot = new URL("../../plumworks-deployments/", import.meta.url);
const [aboutPage, contentLoader, previewSource, importer, content, privatePortrait, publicPortrait] = await Promise.all([
  readFile(new URL("src/app/(marketing)/about/page.tsx", root), "utf8"),
  readFile(new URL("src/lib/marketing-content.ts", root), "utf8"),
  readFile(new URL("src/lib/marketing-content-preview.ts", root), "utf8"),
  readFile(new URL("scripts/import-marketing-content.mjs", root), "utf8"),
  readFile(new URL("clients/cardoc/content/marketing-content.json", privateRoot), "utf8").then(JSON.parse),
  readFile(new URL("clients/cardoc/assets/subbu-veerappan-owner.jpg", privateRoot)),
  readFile(new URL("public/client-assets/cardoc/subbu-veerappan-owner.jpg", root)),
]);

test("Car Doc config contains the complete optional owner content without changing existing About content", () => {
  assert.deepEqual(content.aboutOwner, {
    heading: "Meet the Owner",
    name: "Subbu Veerappan",
    role: "Owner and ASE Master Technician",
    biography: "Subbu Veerappan is the owner of Car Doc, serving drivers in Sterling Heights and nearby communities. Car Doc has provided automotive maintenance and repair services in the area since 2009.\n\nSubbu believes customers should receive clear explanations and practical recommendations before repair work begins. Whether the vehicle needs routine maintenance, diagnostics, or a more involved repair, his focus is on helping customers understand their options and keeping their vehicles safe and reliable.",
    imageUrl: "/client-assets/cardoc/subbu-veerappan-owner.jpg",
    imageAlt: "Subbu Veerappan, owner of Car Doc",
  });
  const about = content.pages.find((page) => page.slug === "about");
  assert.deepEqual(about, {
    slug: "about", eyebrow: "About Car Doc", title: "Straightforward help with vehicle concerns",
    description: "Car Doc provides automotive maintenance, diagnostics, and repair in Sterling Heights.",
    body: "Start by explaining the maintenance need, warning light, sound, or change you have noticed. The shop can evaluate the concern, explain the recommendation in understandable terms, and let you review the work before it proceeds.", active: true,
  });
});

test("portrait is an unchanged local Car Doc asset rather than a hotlink", () => {
  assert.equal(createHash("sha256").update(privatePortrait).digest("hex"), "b30f40d14aab2d8929bbf2bfc6504b3dc187fff35a3a14809f5ad7dc00185b21");
  assert.deepEqual(publicPortrait, privatePortrait);
  assert.doesNotMatch(content.aboutOwner.imageUrl, /^https?:/);
  assert.doesNotMatch(JSON.stringify(content), /subbuscardoc\.com\/custom\/OWNER\.jpg/);
});

test("About renders the optional owner after the unchanged existing content with responsive accessible image markup", () => {
  assert.match(aboutPage, /getMarketingAboutOwner\(\)/);
  assert.ok(aboutPage.indexOf("What stays consistent") < aboutPage.indexOf("owner \? <section"));
  assert.match(aboutPage, /owner \? <section[\s\S]*<h2[\s\S]*owner\.heading[\s\S]*<h3[\s\S]*owner\.name[\s\S]*owner\.role[\s\S]*owner\.biography/);
  assert.match(aboutPage, /<Image src=\{owner\.imageUrl\} alt=\{owner\.imageAlt\} width=\{240\} height=\{300\}/);
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
