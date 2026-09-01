import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const privateRoot = new URL("../../plumworks-deployments/", import.meta.url);
const content = JSON.parse(await readFile(new URL("clients/cardoc/content/marketing-content.json", privateRoot), "utf8"));
const [photosPage, layout, aboutPage, contactPage, homePage, previewSource] = await Promise.all([
  readFile(new URL("src/app/(marketing)/photos/page.tsx", root), "utf8"),
  readFile(new URL("src/app/(marketing)/layout.tsx", root), "utf8"),
  readFile(new URL("src/app/(marketing)/about/page.tsx", root), "utf8"),
  readFile(new URL("src/app/(marketing)/contact/page.tsx", root), "utf8"),
  readFile(new URL("src/app/(marketing)/page.tsx", root), "utf8"),
  readFile(new URL("src/lib/marketing-content-preview.ts", root), "utf8"),
]);

test("Car Doc gallery uses the approved order, captions, alt text, and local assets", async () => {
  const expected = [
    ["subbu-working-primary.jpg", "Subbu at work in the Car Doc service bay"],
    ["shop-service-bays-wide.jpg", "Inside our Sterling Heights repair shop"],
    ["subbu-and-jon.jpg", "The Car Doc team"],
    ["service-alignment-equipment.jpg", "Service and alignment equipment"],
    ["customer-entrance.jpg", "The Car Doc customer entrance"],
    ["subbu-working-secondary.jpg", "Hands-on diagnostics and repair"],
    ["subbu-certifications-original.jpg", "Professional training and certifications"],
    ["roadside-car-doc-sign.jpg", "Look for the Car Doc sign from Mound Road"],
  ];
  assert.deepEqual(content.gallery.map((item) => [item.imageUrl.split("/").at(-1), item.caption]), expected);
  assert.ok(content.gallery.every((item) => item.alt && item.imageUrl.startsWith("/client-assets/cardoc/")));
  for (const [file] of expected) {
    await access(new URL(`public/client-assets/cardoc/${file}`, root));
    await access(new URL(`clients/cardoc/assets/${file}`, privateRoot));
  }
});

test("Photos navigation remains conditional and local gallery images render semantically", () => {
  assert.match(layout, /gallery\.some\(\(item\) => !item\.id\.startsWith\("fallback-"\) && item\.imageUrl\)/);
  assert.match(photosPage, /<Image src=\{item\.imageUrl!\} alt=\{item\.alt \|\| item\.title\}/);
  assert.match(photosPage, /sizes="\(min-width: 1024px\) 33vw/);
  assert.match(previewSource, /if \(value == null\) return \[\]/);
});

test("optional deployment media drives generic homepage, About, and Contact slots", () => {
  assert.deepEqual(content.media.map((item) => item.slot), ["home-primary", "home-secondary", "about-team", "about-credentials", "contact-entrance", "contact-sign"]);
  assert.match(homePage, /primaryMedia\.imageUrl/);
  assert.match(aboutPage, /teamMedia\.imageUrl/);
  assert.match(aboutPage, /credentialsMedia\.imageUrl/);
  assert.match(contactPage, /locationMedia\.map/);
  assert.doesNotMatch(homePage + aboutPage + contactPage, /Car Doc|Subbu|Mound Road|cardoc/);
});
