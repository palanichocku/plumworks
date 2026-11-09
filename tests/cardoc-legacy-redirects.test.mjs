import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/lib/cardoc-legacy-redirects.ts", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../src/config/cardoc-legacy-redirects.json", import.meta.url), "utf8"));
const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");

function resolve(path, host = "www.subbuscardoc.com") {
  const entry = manifest.redirects.find((row) => row.source === new URL(path, "https://example.test").pathname);
  if (!manifest.legacyHosts.includes(host) || !entry) return null;
  const input = new URL(path, `https://${host}`);
  const output = new URL(entry.destination, `https://${manifest.canonicalHostAfterCutover}`);
  for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]) for (const value of input.searchParams.getAll(name)) output.searchParams.append(name, value);
  return output.toString();
}

test("reviewed routes use exact permanent destinations", () => {
  assert.equal(resolve("/Sterling-Heights-auto-brakes.html"), "https://www.subbuscardoc.com/services/brakes");
  assert.equal(resolve("/Sterling-Heights-auto-electronics.html"), "https://www.subbuscardoc.com/services/diagnostics");
  assert.equal(resolve("/Sterling-Heights-transmission-repair.html"), "https://www.subbuscardoc.com/services/transmission-clutch");
  assert.equal(resolve("/Detroit.html"), "https://www.subbuscardoc.com/contact");
  assert.match(proxy, /legacyRedirect\.location, legacyRedirect\.status/);
  assert.match(source, /status: 301 as const/);
});

test("hosts and unknown routes fail closed", () => {
  assert.equal(resolve("/Sterling-Heights-auto-brakes.html", "cardoc-rho.vercel.app"), null);
  assert.equal(resolve("/this-never-existed.html"), null);
  assert.equal(resolve("/services/brakes"), null);
});

test("only approved attribution parameters survive", () => {
  assert.equal(resolve("/Sterling-Heights-auto-brakes.html?utm_source=google&gclid=abc&session=secret&foo=bar"), "https://www.subbuscardoc.com/services/brakes?utm_source=google&gclid=abc");
});

test("manifest is unique, chain-free, and avoids empty optional routes", () => {
  const sources = manifest.redirects.map((entry) => entry.source);
  assert.equal(new Set(sources).size, sources.length);
  const sourceSet = new Set(sources);
  for (const entry of manifest.redirects) {
    assert.equal(entry.status, 301);
    assert.notEqual(entry.source, entry.destination);
    assert.equal(sourceSet.has(entry.destination), false);
    assert.doesNotMatch(entry.destination, /\.(?:html|php)$/i);
    assert.equal(["/reviews", "/photos", "/coupons"].includes(entry.destination), false);
  }
});


test("space-encoded legacy appointment URL redirects without breaking existing mappings", () => {
  // Execute the actual resolver, using its JSON dependency and removing only TS syntax.
  const javascript = source
    .replace(/^import manifest from .*;\n/m, "")
    .replace("export function resolveCardocLegacyRedirect", "function resolveCardocLegacyRedirect")
    .replace("input: URL, hostHeader?: string | null", "input, hostHeader")
    .replace("status: 301 as const", "status: 301");
  const resolver = new Function("manifest", `${javascript}\nreturn resolveCardocLegacyRedirect;`)(manifest);

  for (const path of ["/Sterling%20Heights-appointment-request.php", "/Sterling-Heights-appointment-request.php"]) {
    const result = resolver(new URL(`https://www.subbuscardoc.com${path}`));
    assert.equal(result?.status, 301, path);
    assert.equal(result?.location.href, "https://www.subbuscardoc.com/appointment", path);
  }

  for (const entry of manifest.redirects) {
    const result = resolver(new URL(`https://www.subbuscardoc.com${entry.source}`));
    assert.equal(result?.status, 301, entry.source);
    assert.equal(result?.location.href, `https://www.subbuscardoc.com${entry.destination}`, entry.source);
  }

  assert.equal(resolver(new URL("https://example.com/Sterling%20Heights-appointment-request.php")), null);
  assert.equal(resolver(new URL("https://www.subbuscardoc.com/unknown.php")), null);
  assert.equal(
    resolver(new URL("https://www.subbuscardoc.com/Sterling%20Heights-appointment-request.php?utm_source=google&gclid=abc&private=ignore"))?.location.href,
    "https://www.subbuscardoc.com/appointment?utm_source=google&gclid=abc",
  );
});
