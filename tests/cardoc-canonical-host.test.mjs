import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const { unstable_doesMiddlewareMatch: matches } = require("next/experimental/testing/server");

// Execute the actual TypeScript modules, replacing only the external auth boundary.
async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => dependencies[id] ?? require(id), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const legacy = await loadModule("../src/lib/cardoc-legacy-redirects.ts", {
  "@/config/cardoc-legacy-redirects.json": require("../src/config/cardoc-legacy-redirects.json"),
});
const attribution = await loadModule("../src/lib/marketing-attribution.ts");
const { proxy, config } = await loadModule("../src/proxy.ts", {
  "@/lib/cardoc-legacy-redirects": legacy,
  "@/lib/marketing-attribution": attribution,
  "@/lib/supabase/proxy": { updateSession: () => NextResponse.next({ headers: { "x-test-session": "called" } }) },
});

async function request(host, path, method = "GET") {
  const url = `https://${host}${path}`;
  const headers = { host };
  assert.equal(matches({ config, nextConfig: {}, url, headers }), true);
  return proxy(new NextRequest(url, { headers, method }));
}

for (const method of ["GET", "HEAD", "POST"]) {
  for (const path of ["/", "/about", "/services/brakes", "/contact?utm_source=google&foo=a%20b&foo=c", "/unlisted-route"]) {
    test(`${method} apex ${path} redirects with exact 301 and preserves URL`, async () => {
      const response = await request("subbuscardoc.com", path, method);
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), `https://www.subbuscardoc.com${path}`);
    });
  }
}

for (const host of ["subbuscardoc.com", "www.subbuscardoc.com"]) {
  for (const method of ["GET", "HEAD"]) {
    test(`${method} ${host} mapped legacy URL goes directly to final URL with existing query filtering`, async () => {
      const response = await request(host, "/Sterling-Heights-auto-brakes.html?utm_source=google&gclid=abc&session=secret&foo=bar", method);
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), "https://www.subbuscardoc.com/services/brakes?utm_source=google&gclid=abc");
      const final = await request("www.subbuscardoc.com", "/services/brakes?utm_source=google&gclid=abc", method);
      assert.equal(final.headers.get("location"), null);
    });
  }
}

for (const host of ["www.subbuscardoc.com", "cardoc-rho.vercel.app", "other.example"]) {
  test(`${host} retains modern route and auth behavior`, async () => {
    const response = await request(host, "/about");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    const auth = await request(host, "/dashboard");
    assert.equal(auth.headers.get("x-test-session"), "called");
    assert.equal(matches({ config, nextConfig: {}, url: `https://${host}/unlisted-route`, headers: { host } }), false);
  });
}

test("Vercel host does not redirect mapped legacy URLs", async () => {
  const response = await request("cardoc-rho.vercel.app", "/Sterling-Heights-auto-brakes.html");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("unknown legacy path canonicalizes then passes through for existing 404 handling", async () => {
  const path = "/this-never-existed.html";
  const apex = await request("subbuscardoc.com", path);
  assert.equal(apex.status, 301);
  assert.equal(apex.headers.get("location"), `https://www.subbuscardoc.com${path}`);
  const www = await request("www.subbuscardoc.com", path);
  assert.equal(www.headers.get("location"), null);
  assert.equal(www.headers.get("x-middleware-next"), "1");
  assert.equal(www.headers.get("x-test-session"), null);
});
