import { NextRequest, NextResponse } from "next/server";
import { verifyTwilioFormWebhook } from "@/lib/messaging/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = { "Cache-Control": "no-store" };
const respond = (status: number) => new NextResponse(null, { status, headers: noCache });
const resourceSidPattern = /^[A-Z]{2}[a-f0-9]{32}$/i;
const debuggerSidPattern = /^NO[a-f0-9]{32}$/i;

type DebuggerPayload = { error_code?: unknown; resource_sid?: unknown; service_sid?: unknown };

/**
 * Account-wide Twilio Debugger ERROR/WARNING notifications.
 * The raw Payload can include phone numbers, customer PII, auth headers and
 * webhook bodies. Never log or persist it. Log an allowlisted summary only.
 * This is distinct from per-message SMS delivery status callbacks.
 */
export async function POST(request: NextRequest) {
  const production = process.env.VERCEL_ENV === "production";
  const origin = production ? "https://app.subbuscardoc.com" : "https://dev.subbuscardoc.com";
  const expectedUrl = `${origin}/api/twilio/debugger`;
  const result = await verifyTwilioFormWebhook(
    request, expectedUrl, process.env.TWILIO_AUTH_TOKEN ?? "",
  );
  if (!result.ok) return respond(result.status);
  const params = result.params;
  if (!process.env.TWILIO_ACCOUNT_SID ||
      params.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID) return respond(403);

  const eventSid = params.get("Sid") ?? "";
  const level = (params.get("Level") ?? "").toUpperCase();
  if (!debuggerSidPattern.test(eventSid) ||
      (level !== "ERROR" && level !== "WARNING") ||
      params.get("PayloadType") !== "application/json") return respond(400);

  let payload: DebuggerPayload;
  try {
    const value: unknown = JSON.parse(params.get("Payload") ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) return respond(400);
    payload = value as DebuggerPayload;
  } catch {
    return respond(400);
  }

  const code = typeof payload.error_code === "string" || typeof payload.error_code === "number"
    ? String(payload.error_code) : "";
  const errorCode = /^\d{3,6}$/.test(code) ? code : null;
  const resourceSid = typeof payload.resource_sid === "string" &&
    resourceSidPattern.test(payload.resource_sid) ? payload.resource_sid : null;
  const serviceSid = typeof payload.service_sid === "string" &&
    resourceSidPattern.test(payload.service_sid) ? payload.service_sid : null;
  const summary = { source: "twilio-debugger", eventSid, level, errorCode, resourceSid, serviceSid };
  // Structured Vercel runtime logs, deliberately excluding raw Twilio Payload.
  if (level === "ERROR") console.error(JSON.stringify(summary));
  else console.warn(JSON.stringify(summary));
  return respond(204);
}
