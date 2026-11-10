import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [consent, panel, webhook] = await Promise.all([
  read("src/lib/messaging/sms-consent.ts"),
  read("src/components/customer-sms-consent-panel.tsx"),
  read("src/app/api/sms/inbound/route.ts"),
]);

test("verified START is included in history without fabricating consent", () => {
  assert.match(consent, /'PROVIDER_START' AS "eventType"/);
  assert.match(consent, /'TWILIO_START' AS method/);
  assert.match(consent, /e\.twilio_opt_out_type='START'/);
  assert.match(consent, /e\.keyword='START'/);
  assert.match(consent, /JOIN customers c ON c\.id=\$\{customerId\}::uuid AND c\.shop_id=e\.shop_id/);
  assert.match(panel, /Re-subscribed \(consent still required\)/);
  assert.match(panel, /Verified Text START/);
});

test("START clears transport suppression but never records OPT_IN", () => {
  const start = consent.slice(consent.indexOf("export async function recordSmsStart"));
  assert.match(start, /cleared_at=CURRENT_TIMESTAMP/);
  assert.doesNotMatch(start, /INSERT INTO sms_consent_events|OPT_IN/);
  assert.match(webhook, /carrierAction === "START"/);
  assert.match(webhook, /verifyTwilioFormWebhook/);
});

test("STOP history remains separate and the last consent decision is authoritative", () => {
  assert.match(consent, /WHERE shop_id=\$\{shopId\}::uuid AND customer_id=\$\{customerId\}::uuid/);
  assert.match(consent, /rows\[0\]\?\.eventType === "OPT_IN" \? "CONSENTED"/);
  assert.match(consent, /rows\[0\]\?\.eventType === "DECLINED" \? "DECLINED"/);
  assert.match(consent, /WHERE e\.shop_id=\$\{shopId\}::uuid AND e\.keyword='START'/);
});
