import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("public Car Doc GA4 tracking is isolated from staff application and env-gated", async () => {
  const publicLayout = await read("src/app/(marketing)/layout.tsx");
  const rootLayout = await read("src/app/layout.tsx");
  const component = await read("src/components/marketing/marketing-ga4-tag.tsx");
  const privacy = await read("src/app/(marketing)/privacy/page.tsx");
  assert.match(publicLayout, /<MarketingGa4Tag \/>/);
  assert.doesNotMatch(rootLayout, /MarketingGa4Tag/);
  assert.match(component, /process\.env\.GA4_MEASUREMENT_ID/);
  assert.match(component, /if \(!id \|\|/);
  assert.match(component, /strategy="afterInteractive"/);
  assert.match(component, /gtag\('config'/);
  assert.match(privacy, /Website analytics/);
  assert.match(privacy, /We do not send customer names, phone numbers, email addresses/);
});
