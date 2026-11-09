import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";
import { recordSmsStop, recordSmsStart, assertSmsConsentDev } from "@/lib/messaging/sms-consent";
import { verifyTwilioFormWebhook } from "@/lib/messaging/twilio-webhook";

export const runtime = "nodejs";
const reply = (status = 200) => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
  status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
});

export async function POST(request: NextRequest) {
  try { assertSmsConsentDev(); } catch { return reply(404); }
  const expectedUrl = "https://dev.subbuscardoc.com/api/sms/inbound";
  if (process.env.SMS_TWILIO_WEBHOOK_URL !== expectedUrl) return reply(503);
  const result = await verifyTwilioFormWebhook(request, expectedUrl, process.env.TWILIO_AUTH_TOKEN ?? "");
  if (!result.ok) return reply(result.status);
  const params = result.params;
  if (!process.env.TWILIO_ACCOUNT_SID || params.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID)
    return reply(403);
  const from = normalizeUsSmsPhone(params.get("From") ?? "");
  const to = normalizeUsSmsPhone(params.get("To") ?? "");
  const sid = params.get("MessageSid") ?? "";
  if (!from || !to || !/^SM[a-f0-9]{32}$/i.test(sid)) return reply(400);

  // Exact keyword matches: "STOP please" is not a valid carrier opt-out command.
  const carrierAction = (params.get("OptOutType") ?? "").trim().toUpperCase();
  const body = (params.get("Body") ?? "").trim().toUpperCase();
  const stopWords = ["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"];
  const helpWords = ["HELP","INFO","SUPPORT"];
  const action = carrierAction === "STOP" || stopWords.includes(body) ? "STOP" :
    carrierAction === "HELP" || helpWords.includes(body) ? "HELP" :
    // Only Twilio's verified Advanced Opt-Out event may lift STOP suppression.
    // Plain-text START, forged bodies, and HELP must never lift a block.
    carrierAction === "START" ? "START" : null;
  if (!action) return reply();
  const rows = await prisma.$queryRaw<Array<{ shopId: string }>>`
    SELECT shop_id AS "shopId" FROM sms_sender_numbers WHERE phone_e164=${to} LIMIT 1`;
  const shopId = rows[0]?.shopId;
  if (!shopId) return reply(404);

  // Twilio signature and account were checked above. START merely unblocks
  // the number; it never generates a new opt-in consent event.
  // Ignore duplicate webhook deliveries so a replayed STOP cannot re-block
  // a number after a later verified START.
  const previous = await prisma.$queryRaw<Array<{ messageSid: string }>>`
    SELECT message_sid AS "messageSid" FROM sms_inbound_events
    WHERE shop_id=${shopId}::uuid AND message_sid=${sid} LIMIT 1`;
  if (previous.length) return reply();
  if (action === "STOP") await recordSmsStop(shopId, from);
  if (action === "START") await recordSmsStart(shopId, from);
  // Diagnostic: persist only Twilio's recognized Advanced Opt-Out category.
  // A missing OptOutType stays NULL; never store raw webhook fields or message body.
  const recognizedOptOutType = ["STOP", "HELP", "START"].includes(carrierAction) ? carrierAction : null;
  await prisma.$executeRaw`
    INSERT INTO sms_inbound_events(shop_id,message_sid,phone_e164,keyword,twilio_opt_out_type)
    VALUES(${shopId}::uuid,${sid},${from},${action},${recognizedOptOutType})
    ON CONFLICT DO NOTHING`;
  // Provider autoresponses must be configured in the Messaging Service.
  return reply();
}
