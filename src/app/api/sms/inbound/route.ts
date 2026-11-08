import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";
import { recordSmsStop, assertSmsConsentDev } from "@/lib/messaging/sms-consent";

export const runtime = "nodejs";
const reply = (status = 200) => new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", {
 status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
});

/** Twilio form webhook, signed with the private account Auth Token. No secrets logged. */
export async function POST(request: NextRequest) {
 try { assertSmsConsentDev(); } catch { return reply(404); }
 const expectedUrl = process.env.SMS_TWILIO_WEBHOOK_URL;
 const secret = process.env.TWILIO_AUTH_TOKEN;
 if (!expectedUrl || !secret || expectedUrl !== "https://dev.subbuscardoc.com/api/sms/inbound") return reply(503);
 const signature = request.headers.get("x-twilio-signature");
 if (!signature || request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/x-www-form-urlencoded") return reply(403);
 const raw = await request.text();
 if (raw.length > 10000) return reply(413);
 const params = new URLSearchParams(raw);
 const keys = [...new Set(params.keys())].sort();
 if (keys.some(key => params.getAll(key).length !== 1)) return reply(403);
 const payload = expectedUrl + keys.map(key => key + (params.get(key) ?? "")).join("");
 const mac = createHmac("sha1", secret).update(payload).digest("base64");
 const a = Buffer.from(mac), b = Buffer.from(signature);
 if (a.length !== b.length || !timingSafeEqual(a, b)) return reply(403);
 const from = normalizeUsSmsPhone(params.get("From") ?? "");
 const to = normalizeUsSmsPhone(params.get("To") ?? "");
 const messageSid = params.get("MessageSid") ?? "";
 if (!from || !to || !/^SM[a-f0-9]{32}$/i.test(messageSid)) return reply(400);
 const keyword = (params.get("OptOutType") || params.get("Body") || "").trim().toUpperCase().split(/\s+/)[0];
 const action = ["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"].includes(keyword) ? "STOP" :
   ["HELP","INFO","SUPPORT"].includes(keyword) ? "HELP" : null;
 if (!action) return reply();
 const rows = await prisma.$queryRaw<Array<{ shopId: string }>>`
   SELECT shop_id AS "shopId" FROM sms_sender_numbers WHERE phone_e164=${to} LIMIT 1`;
 const shopId = rows[0]?.shopId;
 if (!shopId) return reply(404);
 const inserted = await prisma.$queryRaw<Array<{ messageSid: string }>>`
   INSERT INTO sms_inbound_events(shop_id,message_sid,phone_e164,keyword)
   VALUES(${shopId}::uuid,${messageSid},${from},${action})
   ON CONFLICT DO NOTHING RETURNING message_sid AS "messageSid"`;
 if (inserted.length && action === "STOP") await recordSmsStop(shopId, from);
 // Twilio Messaging Service's default opt-out and HELP auto-responses are authoritative.
 // Returning empty TwiML avoids duplicate replies or unapproved outbound sends.
 return reply();
}
