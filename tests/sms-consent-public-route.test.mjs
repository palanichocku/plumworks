import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const match = proxy.match(/function isPublicSmsConsentPath\(pathname: string\) \{([\s\S]*?)\n\}/);
assert.ok(match, "SMS customer consent public-route predicate must exist");
const isPublicSmsConsentPath = new Function("pathname", match[1]);

test("customer QR consent tokens and completion are publicly routable", () => {
  assert.equal(isPublicSmsConsentPath("/sms-consent/" + "a".repeat(43)), true);
  assert.equal(isPublicSmsConsentPath("/sms-consent/completed"), true);
  assert.match(proxy, /if \(hostname === PRODUCTION_APP_HOST\) \{\s*if \(isPublicSmsConsentPath\(pathname\)\) return NextResponse\.next\(\);/);
  assert.match(proxy, /if \(isPublicAuthorizationPath\(pathname\) \|\| isPublicSmsConsentPath\(pathname\)\) return NextResponse\.next\(\);/);
});

test("invalid and unrelated shop routes remain protected", () => {
  for (const path of [
    "/sms-consent", "/sms-consent/example", "/sms-consent/not-a-real-token",
    "/sms-consent/" + "a".repeat(101), "/sms-consent/" + "a".repeat(43) + "/extra",
    "/customers", "/customers/123", "/repair-orders", "/repair-orders/123",
    "/api/sms/inbound", "/dashboard"
  ]) {
    assert.equal(isPublicSmsConsentPath(path), false, path);
  }
});
