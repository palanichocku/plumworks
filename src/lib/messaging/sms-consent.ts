import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";

export const SMS_CONSENT_VERSION = "2026-11-08-service-v1";
export function smsConsentText(shopName: string) {\n  return `I agree to receive text messages from ${shopName} about repair estimates and vehicle service updates at the mobile number shown. Message frequency varies by service activity. Message and data rates may apply. Reply STOP to unsubscribe or HELP for assistance. Consent is optional and is not a condition of purchase.`;\n}
const TOKEN_RE = /^[A-Za-z0-9_-]{40,100}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const masked = (number: string) => `(***) ***-${number.slice(-4)}`;

/** Consent collection is deliberately restricted to nonproduction environments. */
export function assertSmsConsentDev() {
  if (process.env.VERCEL_ENV === "production" ||
      (process.env.NODE_ENV !== "development" && process.env.VERCEL_GIT_COMMIT_REF !== "dev" &&
       process.env.VERCEL_GIT_COMMIT_REF !== "feature/dev-digital-sms-consent")) {
    throw new Error("SMS consent collection is not enabled in this environment.");
  }
}

type SessionRow = {
  id: string; shopId: string; customerId: string; phone: string; tokenHash: string;
  pinHash: string; version: string; method: "IN_SHOP_IPAD" | "IN_SHOP_QR"; expiresAt: Date; consumedAt: Date | null;
  cancelledAt: Date | null; attempts: number; shopName: string; customerPhone: string | null;
  archivedAt: Date | null;
};
const sessionSelect = `SELECT s.id, s.shop_id AS "shopId", s.customer_id AS "customerId",
s.phone_e164 AS phone, s.token_sha256 AS "tokenHash", s.staff_pin_sha256 AS "pinHash",
s.disclosure_version AS version, s.collection_method AS method, s.expires_at AS "expiresAt", s.consumed_at AS "consumedAt",
s.cancelled_at AS "cancelledAt", s.failed_pin_attempts AS attempts, sh.name AS "shopName",
c.phone AS "customerPhone", c.archived_at AS "archivedAt"
FROM sms_consent_sessions s JOIN shops sh ON sh.id=s.shop_id
JOIN customers c ON c.id=s.customer_id AND c.shop_id=s.shop_id`;

export async function createConsentSession(input: {
  shopId: string; customerId: string; staffId: string; method: "IN_SHOP_IPAD" | "IN_SHOP_QR";
}) {
  assertSmsConsentDev();
  if (![input.shopId, input.customerId, input.staffId].every(v => uuid.test(v))) throw new Error("Invalid identifiers.");
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, shopId: input.shopId, archivedAt: null },
    select: { phone: true },
  });
  const phone = normalizeUsSmsPhone(customer?.phone ?? "");
  if (!phone) throw new Error("Customer must have a valid US mobile number in the primary phone field.");
  const token = randomBytes(32).toString("base64url");
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO sms_consent_sessions (shop_id, customer_id, phone_e164,
      token_sha256, staff_pin_sha256, disclosure_version, collection_method, created_by_user_id, expires_at)
    VALUES (${input.shopId}::uuid, ${input.customerId}::uuid, ${phone},
      ${digest(token)}, ${digest(pin)}, ${SMS_CONSENT_VERSION}, ${input.method}, ${input.staffId}::uuid, ${expiresAt})
    RETURNING id`;
  return { id: rows[0].id, token, pin, expiresAt, phone: masked(phone), method: input.method };
}

async function findSession(token: string): Promise<SessionRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  return prisma.$queryRawUnsafe<SessionRow[]>(
    `${sessionSelect} WHERE s.token_sha256=$1 LIMIT 1`, digest(token)
  ).then(rows => rows[0] ?? null);
}

function active(row: SessionRow | null) {
  return Boolean(row && !row.consumedAt && !row.cancelledAt &&
    row.attempts < 5 && row.expiresAt.getTime() > Date.now() &&
    !row.archivedAt && normalizeUsSmsPhone(row.customerPhone ?? "") === row.phone);
}

export async function getConsentPage(token: string) {
  assertSmsConsentDev();
  const row = await findSession(token);
  if (!active(row) || !row) return null;
  return { shopName: row.shopName, phone: masked(row.phone), disclosure: smsConsentText(row.shopName), expiresAt: row.expiresAt };
}

export async function submitConsent(input: {
  token: string; pin: string; checked: boolean; customerName: string;
}) {
  assertSmsConsentDev();
  if (!TOKEN_RE.test(input.token) || !/^\d{6}$/.test(input.pin) ||
    input.customerName.trim().length < 2 || input.customerName.trim().length > 120) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const row = await findSession(input.token);
  if (!active(row) || !row) return { ok: false as const, reason: "expired" as const };
  const known = Buffer.from(row.pinHash, "hex"), candidate = Buffer.from(digest(input.pin), "hex");
  if (!timingSafeEqual(known, candidate)) {
    await prisma.$executeRaw`UPDATE sms_consent_sessions
      SET failed_pin_attempts=LEAST(failed_pin_attempts+1,5)
      WHERE id=${row.id}::uuid AND consumed_at IS NULL AND cancelled_at IS NULL`;
    return { ok: false as const, reason: "invalid" as const };
  }

  // Lock the session and customer together: once used, even concurrent submissions fail.
  return prisma.$transaction(async tx => {
    const sessions = await tx.$queryRaw<SessionRow[]>`
      SELECT s.id, s.shop_id AS "shopId", s.customer_id AS "customerId",
      s.phone_e164 AS phone, s.token_sha256 AS "tokenHash", s.staff_pin_sha256 AS "pinHash",
      s.disclosure_version AS version, s.expires_at AS "expiresAt", s.consumed_at AS "consumedAt",
      s.cancelled_at AS "cancelledAt", s.failed_pin_attempts AS attempts,
      sh.name AS "shopName", c.phone AS "customerPhone", c.archived_at AS "archivedAt"
      FROM sms_consent_sessions s JOIN shops sh ON sh.id=s.shop_id
      JOIN customers c ON c.id=s.customer_id AND c.shop_id=s.shop_id
      WHERE s.id=${row.id}::uuid FOR UPDATE OF s, c`;
    const current = sessions[0];
    if (!active(current) || !current || !timingSafeEqual(Buffer.from(current.pinHash, "hex"), candidate))
      return { ok: false as const, reason: "expired" as const };
    await tx.$executeRaw`UPDATE sms_consent_sessions SET consumed_at=CURRENT_TIMESTAMP WHERE id=${current.id}::uuid`;
    if (input.checked) {
      await tx.$executeRaw`INSERT INTO sms_consent_events
        (shop_id, customer_id, session_id, phone_e164, event_type, method,
         disclosure_version, disclosure_text, customer_name)
        VALUES (${current.shopId}::uuid, ${current.customerId}::uuid,
          ${current.id}::uuid, ${current.phone}, 'OPT_IN', ${current.method},
          ${SMS_CONSENT_VERSION}, ${smsConsentText(current.shopName)}, ${input.customerName.trim()})`;
    }
    return { ok: true as const, consented: input.checked };
  });
}

export async function getSmsConsentStatus(shopId: string, customerId: string, phoneValue: string | null) {
  const phone = normalizeUsSmsPhone(phoneValue ?? "");
  if (!phone || !uuid.test(shopId) || !uuid.test(customerId)) return "MISSING" as const;
  const rows = await prisma.$queryRaw<Array<{ eventType: "OPT_IN" | "OPT_OUT" | null; suppressed: boolean }>>`
    SELECT (SELECT event_type FROM sms_consent_events
      WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
        AND phone_e164=${phone} ORDER BY occurred_at DESC, id DESC LIMIT 1) AS "eventType",
      EXISTS(SELECT 1 FROM sms_phone_suppressions
        WHERE shop_id=${shopId}::uuid AND phone_e164=${phone}) AS suppressed`;
  return rows[0]?.suppressed ? "OPTED_OUT" as const :
    rows[0]?.eventType === "OPT_IN" ? "CONSENTED" as const : "MISSING" as const;
}

export async function assertSmsRecipientConsented(shopId: string, customerId: string, phone: string) {
  assertSmsConsentDev();
  if (await getSmsConsentStatus(shopId, customerId, phone) !== "CONSENTED")
    throw new Error("SMS consent is missing or this number has opted out. Collect new consent before texting.");
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId }, select: { phone: true },
  });
  if (normalizeUsSmsPhone(customer?.phone ?? "") !== phone)
    throw new Error("SMS number must match the customer's currently consented mobile number.");
}

/** STOP suppresses every customer record in this shop for the same number. */
export async function recordSmsStop(shopId: string, phone: string) {
  if (!uuid.test(shopId) || !normalizeUsSmsPhone(phone)) return;
  const matches = await prisma.customer.findMany({ where: { shopId, OR: [{ phone }, { phone2: phone }] }, select: { id: true } });
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO sms_phone_suppressions(shop_id,phone_e164,source)
      VALUES(${shopId}::uuid,${phone},'TWILIO_STOP') ON CONFLICT (shop_id, phone_e164)
      DO UPDATE SET suppressed_at=CURRENT_TIMESTAMP, source='TWILIO_STOP'`;
    for (const customer of matches) await tx.$executeRaw`
      INSERT INTO sms_consent_events(shop_id,customer_id,phone_e164,event_type,method)
      VALUES (${shopId}::uuid,${customer.id}::uuid,${phone},'OPT_OUT','TWILIO_STOP')`;
  });
}
