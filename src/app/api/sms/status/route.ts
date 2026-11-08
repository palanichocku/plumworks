import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSmsConsentDev } from "@/lib/messaging/sms-consent";
import { verifyTwilioFormWebhook } from "@/lib/messaging/twilio-webhook";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(status = 200) {
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** Signed, per-request Twilio delivery status callback. No approval tokens or PII logged. */
export async function POST(request: NextRequest) {
  try { assertSmsConsentDev(); } catch { return respond(404); }
  const base = "https://dev.subbuscardoc.com/api/sms/status";
  if (process.env.SMS_TWILIO_STATUS_URL !== base) return respond(503);
  const id = request.nextUrl.searchParams.get("requestId") ?? "";
  if (!uuid.test(id) || [...request.nextUrl.searchParams.keys()].some(key => key !== "requestId"))
    return respond(400);
  const exactUrl = `${base}?requestId=${encodeURIComponent(id)}`;
  const result = await verifyTwilioFormWebhook(request, exactUrl, process.env.TWILIO_AUTH_TOKEN ?? "");
  if (!result.ok) return respond(result.status);
  const params = result.params;
  if (!process.env.TWILIO_ACCOUNT_SID || params.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID)
    return respond(403);
  const messageSid = params.get("MessageSid") ?? params.get("SmsSid") ?? "";
  if (!/^SM[a-f0-9]{32}$/i.test(messageSid)) return respond(400);

  const raw = (params.get("MessageStatus") ?? params.get("SmsStatus") ?? "").toLowerCase();
  const deliveryStatus = raw === "delivered" || raw === "read" ? "delivered" :
    raw === "undelivered" ? "undelivered" : raw === "failed" ? "failed" :
    ["accepted","queued","sending","sent","scheduled"].includes(raw) ? "accepted" : null;
  if (!deliveryStatus) return respond(200); // Unknown provider status: ignore safely.

  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE authorization_requests
    SET sms_provider_id = COALESCE(sms_provider_id, ${messageSid}),
        sms_delivery_status = CASE
          WHEN sms_delivery_status = 'delivered' THEN 'delivered'
          WHEN sms_delivery_status IN ('failed','undelivered') AND ${deliveryStatus} <> 'delivered'
            THEN sms_delivery_status
          WHEN ${deliveryStatus} = 'accepted' AND sms_delivery_status IS NOT NULL
            THEN sms_delivery_status
          ELSE ${deliveryStatus} END
    WHERE id = ${id}::uuid AND channel = 'SMS'
      AND (sms_provider_id IS NULL OR sms_provider_id = ${messageSid})
    RETURNING id`;
  // Unknown request or unexpected MessageSid: no mutation, no PII in response.
  if (!updated.length) return respond(404);
  return respond();
}
