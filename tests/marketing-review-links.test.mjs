import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(new URL("../src/lib/marketing-review-links.ts", import.meta.url), "utf8");
const directory = await mkdtemp(join(tmpdir(), "marketing-review-links-"));
const moduleFile = join(directory, "review-links.ts");
await writeFile(moduleFile, `function shopAddress(shop) { return [shop.addressLine1, [shop.city, shop.state].filter(Boolean).join(", "), shop.postalCode].filter(Boolean).join(" "); }\n${source.replace(/^import .*;\n/gm, "")}`);
const { getReviewLinks } = await import(moduleFile);

const carDoc = { name: "Car Doc", addressLine1: "42464 MOUND ROAD", city: "Sterling Heights", state: "MI", postalCode: "48314", phone: "586-843-3347" };

test("Car Doc's verified profiles are available without credentials or rating claims", () => {
  const links = getReviewLinks(carDoc);
  assert.match(links.google, /query_place_id=ChIJ6c7M8uXcJIgRB8kgW2jUZ9A/);
  assert.equal(links.facebook, "https://www.facebook.com/subbuscardoc/");
  assert.equal(links.leaveGoogle, links.google);
  assert.doesNotMatch(source, /AggregateRating|reviewCount|rating:\s*[1-5]/);
});

test("other tenants never inherit Car Doc's review destinations", () => {
  for (const shop of [{ ...carDoc, phone: "586-000-0000" }, { ...carDoc, addressLine1: "100 Other Road" }])
    assert.deepEqual(getReviewLinks(shop, "https://g.page/other/review"), { google: null, facebook: null, leaveGoogle: null });
});

test("only trusted HTTPS Google review destinations replace the Google profile fallback", () => {
  assert.equal(getReviewLinks(carDoc, "https://g.page/r/ABC/review").leaveGoogle, "https://g.page/r/ABC/review");
  for (const unsafe of ["http://www.google.com/review", "https://google.com.evil.test/", "javascript:alert(1)", "https://user:pass@google.com/review"])
    assert.equal(getReviewLinks(carDoc, unsafe).leaveGoogle, getReviewLinks(carDoc).google);
});
