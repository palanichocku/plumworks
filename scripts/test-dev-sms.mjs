/**
 * Explicit opt-in test of the Twilio development sender.
 * Example:
 * SMS_DEV_SEND_ENABLED=true SMS_DEV_ALLOWED_TO=+1XXXXXXXXXX \\
 *   node --env-file=.env.development.local scripts/test-dev-sms.mjs
 *
 * This script intentionally never uses a production .env file.
 */
import fs from "node:fs";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const required = [".env.development.local", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM", "SMS_DEV_ALLOWED_TO"];
if (!fs.existsSync(required[0])) {
  fail("Missing .env.development.local. This command only supports local development.");
} else if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  fail("Production environment is not allowed.");
} else if (process.env.SMS_DEV_SEND_ENABLED !== "true") {
  fail("Sending disabled. Set SMS_DEV_SEND_ENABLED=true only for an intentional test.");
} else if (!required.slice(1).every((key) => Boolean(process.env[key]?.trim()))) {
  fail("Missing Twilio settings or SMS_DEV_ALLOWED_TO in the local development environment.");
} else if (!/^AC[a-f0-9]{32}$/i.test(process.env.TWILIO_ACCOUNT_SID)) {
  fail("Invalid Twilio Account SID.");
} else if (![process.env.TWILIO_SMS_FROM, process.env.SMS_DEV_ALLOWED_TO].every((n) => /^\+[1-9]\d{7,14}$/.test(n))) {
  fail("Sender and allowed recipient must be E.164 phone numbers.");
} else {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const testBody = process.env.SMS_DEV_TEST_BODY || "sms_appointment_reminders";
  const form = new URLSearchParams({
    From: process.env.TWILIO_SMS_FROM,
    To: process.env.SMS_DEV_ALLOWED_TO,
    Body: testBody,
  });
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.sid) {
      fail(`Twilio rejected the test message (HTTP ${response.status}, code ${String(result.code ?? "unknown")}).`);
    } else {
      console.log("Twilio accepted the development test SMS.");
      console.log("Message ID:", result.sid);
      console.log("Delivery is not confirmed by this response. Check the Twilio Messaging logs and your phone.");
    }
  } catch {
    fail("Twilio could not be reached. No successful submission was confirmed.");
  }
}
