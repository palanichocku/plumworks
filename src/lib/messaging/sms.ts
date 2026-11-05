import "server-only";

import type { SmsDeliveryRequest, SmsDeliveryResult, SmsProvider } from "./types";

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Real SMS is intentionally disabled unless specifically enabled in a
 * non-production environment. This is the Phase-2 development adapter,
 * NOT the shop-facing authorization workflow.
 */
export function assertDevelopmentSmsEnabled() {
  if (process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production" ||
      process.env.SMS_DEV_SEND_ENABLED !== "true") {
    throw new Error("Development SMS sending is disabled.");
  }
}

export function validateSmsRequest(request: SmsDeliveryRequest) {
  if (!E164.test(request.to) || !E164.test(request.from)) {
    throw new Error("SMS sender and recipient must use E.164 format.");
  }
  if (!request.body.trim() || request.body.length > 1200) {
    throw new Error("SMS body must contain 1 to 1200 characters.");
  }
}

class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  async send(request: SmsDeliveryRequest): Promise<SmsDeliveryResult> {
    assertDevelopmentSmsEnabled();
    validateSmsRequest(request);
    if (!process.env.SMS_DEV_ALLOWED_TO || request.to !== process.env.SMS_DEV_ALLOWED_TO) {
      throw new Error("Recipient is not the allowed development test number.");
    }
    if (!process.env.TWILIO_SMS_FROM || request.from !== process.env.TWILIO_SMS_FROM) {
      throw new Error("Sender must match the configured development number.");
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !/^AC[a-f0-9]{32}$/i.test(accountSid) || !authToken) {
      return { ok: false, errorCode: "not_configured", message: "Twilio development credentials are missing." };
    }

    const form = new URLSearchParams({
      From: request.from,
      To: request.to,
      Body: request.body,
    });

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );

      const data: { sid?: unknown; code?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.sid !== "string") {
        // Do not expose Twilio response text: it can contain phone numbers or other PII.
        return { ok: false, errorCode: String(data.code ?? response.status), message: "Twilio did not accept the SMS." };
      }
      return { ok: true, providerMessageId: data.sid, status: "accepted" };
    } catch {
      return { ok: false, errorCode: "network_error", message: "SMS provider could not be reached." };
    }
  }
}

export function createDevelopmentSmsProvider(): SmsProvider {
  assertDevelopmentSmsEnabled();
  // Additional provider adapters can implement SmsProvider without changing callers.
  return new TwilioSmsProvider();
}
