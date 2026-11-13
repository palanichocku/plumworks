import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("GA4 tag stays on public marketing layout and is disabled without a valid measurement ID", async () => {
  const marketing = await read("src/app/(marketing)/layout.tsx");
  const tag = await read("src/components/marketing/marketing-ga4-tag.tsx");
  const root = await read("src/app/layout.tsx");
  assert.match(marketing, /MarketingGa4Tag/);
  assert.doesNotMatch(root, /MarketingGa4Tag/);
  assert.match(tag, /process\.env\.GA4_MEASUREMENT_ID/);
  assert.match(tag, /G-\[A-Z0-9\]/);
  assert.match(tag, /if \(!id/);
  assert.match(tag, /strategy="afterInteractive"/);
  assert.match(tag, /gtag\('config'/);
  assert.doesNotMatch(tag, /send_page_view: false|page_view.*page_view/);
});
test("GA4 report is read-only, counts missing data as unknown, and does not expose credentials", async () => {
  const source = await read("src/lib/ga4-visitor-report.ts");
  const panel = await read("src/app/(app)/dashboard/website-performance/ga4-visitor-panel.tsx");
  const page = await read("src/app/(app)/dashboard/website-performance/page.tsx");
  assert.match(source, /analytics\.readonly/);
  assert.match(source, /GA4_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /GA4_PROPERTY_ID/);
  assert.match(source, /properties\/\$\{property\}:runReport/);
  assert.match(source, /"not_configured" \| "available" \| "unavailable"/);
  assert.match(source, /visitors: null, sessions: null/);
  assert.match(source, /lastCompleteGa4Month/);
  assert.match(source, /return \{ \.\.\.result, state: "unavailable" \}/);
  assert.match(panel, /Active visitors/);
  assert.match(panel, /Engaged visits/);
  assert.match(panel, /How visitors arrived/);
  assert.match(panel, /Most-viewed pages/);
  assert.match(panel, /not connected yet/);
  assert.match(page, /Ga4VisitorPanel/);
});
test("GA4 public event and privacy copy avoid personal identifiers", async () => {
  const calls = await read("src/components/marketing/tracked-call-link.tsx");
  const privacy = await read("src/app/(marketing)/privacy/page.tsx");
  assert.match(calls, /call_button_click/);
  assert.doesNotMatch(calls, /gtag\?\.\("event", "call_button_click",.*href/);
  assert.match(privacy, /Website analytics/);
  assert.match(privacy, /We do not send customer names, phone numbers, email addresses/);
});
