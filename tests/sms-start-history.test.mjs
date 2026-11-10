import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [consent, panel, webhook] = await Promise.all([
  read("src/lib/messaging/sms-consent.ts"),
  read("src/components/customer-sms-consent-panel.tsx"),
  read("src/app/api/sms/inbound/route.ts"),
]);

test("verified START is linked to prior consent only where eligible", () => {
  assert.match(consent, /'PROVIDER_RECONSENT'/);
  assert.match(consent, /'PROVIDER_START'/);
  assert.match(consent, /'TWILIO_START' AS method/);
  assert.match(consent, /e\.twilio_opt_out_type='START'/);
  assert.match(consent, /e\.keyword='START'/);
  assert.match(consent, /decision\.disclosure_version=\$\{SMS_CONSENT_VERSION\}/);
  assert.match(consent, /decline\.event_type='DECLINED'/);
  assert.match(consent, /JOIN customers c ON c\.id=\$\{customerId\}::uuid AND c\.shop_id=e\.shop_id/);
  assert.match(panel, /Consent restored from prior approval/);
  assert.match(panel, /Re-subscribed \(fresh consent required\)/);
  assert.match(panel, /Linked to prior documented consent/);
});

test("START clears transport suppression but never records OPT_IN", () => {
  const start = consent.slice(consent.indexOf("export async function recordSmsStart"));
  assert.match(start, /cleared_at=CURRENT_TIMESTAMP/);
  assert.doesNotMatch(start, /INSERT INTO sms_consent_events|OPT_IN/);
  assert.match(webhook, /carrierAction === "START"/);
  assert.match(webhook, /verifyTwilioFormWebhook/);
});
 
test("STOP and latest declined consent remain authoritative", () => {
  assert.match(consent, /if \(evidence\.suppressed\) return "OPTED_OUT"/);
  assert.match(consent, /if \(evidence\.eventType === "DECLINED"\) return "DECLINED"/);
  assert.match(consent, /canRestoreSmsConsent\(\{ \.\.\.evidence, latestDecision: evidence\.eventType \}, SMS_CONSENT_VERSION\)/);
  assert.match(consent, /AND phone_e164=\$\{phone\}/);
  assert.match(consent, /AND twilio_opt_out_type='START'/);
});
