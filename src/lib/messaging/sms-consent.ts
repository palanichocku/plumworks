import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";
import { canRestoreSmsConsent } from "@/lib/messaging/sms-reconsent-policy";

export const SMS_CONSENT_VERSION = "2026-11-08-service-v1";
export function smsConsentText(shopName: string) {
  return `I agree to receive text messages from ${shopName} about repair estimates and vehicle service updates at the mobile number shown. Message frequency varies by service activity. Message and data rates may apply. Reply STOP to unsubscribe or HELP for assistance. Consent is optional and is not a condition of purchase.`;
}
const TOKEN_RE = /^[A-Za-z0-9_-]{40,100}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const masked = (number: string) => `(***) ***-${number.slice(-4)}`;

/** Consent collection is deliberately restricted to nonproduction environments. */
export function assertSmsConsentDev() {
  if (process.env.VERCEL_ENV === "production" ||
      (process.env.NODE_ENV !== "development" && process.env.VERCEL_GIT_COMMIT_REF !== "dev" &&
       process.env.VERCEL_GIT_COMMIT_REF !== "feature/dev-sms-consent-ux-handoff")) {
    throw new Error("SMS consent collection is not enabled in this environment.");
  }
}

type SessionRow = {
  id: string; shopId: string; customerId: string; createdByUserId: string; phone: string; tokenHash: string;
  pinHash: string; version: string; method: "IN_SHOP_IPAD" | "IN_SHOP_QR"; expiresAt: Date; consumedAt: Date | null;
  cancelledAt: Date | null; attempts: number; shopName: string; customerPhone: string | null;
  archivedAt: Date | null;
};
const sessionSelect = `SELECT s.id, s.shop_id AS "shopId", s.customer_id AS "customerId",
s.phone_e164 AS phone, s.token_sha256 AS "tokenHash", s.staff_pin_sha256 AS "pinHash",
s.created_by_user_id AS "createdByUserId", s.created_by_user_id AS "createdByUserId", s.disclosure_version AS version, s.collection_method AS method, s.expires_at AS "expiresAt", s.consumed_at AS "consumedAt",
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
  const rows = await prisma.$transaction(async tx => {
    // A fresh collection supersedes other unused codes for this customer.
    await tx.$executeRaw`UPDATE sms_consent_sessions SET cancelled_at=CURRENT_TIMESTAMP
      WHERE shop_id=${input.shopId}::uuid AND customer_id=${input.customerId}::uuid
      AND consumed_at IS NULL AND cancelled_at IS NULL`;
    return tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO sms_consent_sessions (shop_id, customer_id, phone_e164,
      token_sha256, staff_pin_sha256, disclosure_version, collection_method, created_by_user_id, expires_at)
    VALUES (${input.shopId}::uuid, ${input.customerId}::uuid, ${phone},
      ${digest(token)}, ${digest(pin)}, ${SMS_CONSENT_VERSION}, ${input.method}, ${input.staffId}::uuid, ${expiresAt})
    RETURNING id`;
  });
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

export type ConsentStaff = { shopId: string; userId: string };

export async function getConsentPage(token: string, staff?: ConsentStaff, returnRoId?: string) {
  assertSmsConsentDev();
  const row = await findSession(token);
  if (!active(row) || !row) return null;
  if (row.method === "IN_SHOP_IPAD") {
    if (!staff || staff.shopId !== row.shopId || staff.userId !== row.createdByUserId) return null;
  }
  const customer = await prisma.customer.findFirst({
    where: { id: row.customerId, shopId: row.shopId, archivedAt: null },
    select: { displayName: true },
  });
  if (!customer) return null;
  // Only shop-iPad handoffs can return to the originating RO. Never trust a
  // caller-provided route without verifying both customer and shop ownership.
  const validReturnRo = row.method === "IN_SHOP_IPAD" && returnRoId && uuid.test(returnRoId)
    ? await prisma.repairOrder.findFirst({
        where: { id: returnRoId, shopId: row.shopId, customerId: row.customerId },
        select: { id: true },
      })
    : null;
  return { shopName: row.shopName, customerName: customer.displayName, phone: masked(row.phone),
    disclosure: smsConsentText(row.shopName),
    expiresAt: row.expiresAt.toISOString(), method: row.method,
    returnRoId: validReturnRo?.id ?? null };
}

/** PIN step for customer-owned phones. Checking it does not create consent. */
export async function verifyConsentPin(token: string, pin: string): Promise<boolean> {
  assertSmsConsentDev();
  if (!TOKEN_RE.test(token) || !/^\d{6}$/.test(pin)) return false;
  const row = await findSession(token);
  if (!active(row) || !row || row.method !== "IN_SHOP_QR") return false;
  const matches = timingSafeEqual(Buffer.from(row.pinHash, "hex"), Buffer.from(digest(pin), "hex"));
  if (!matches) {
    await prisma.$executeRaw`UPDATE sms_consent_sessions SET failed_pin_attempts=LEAST(failed_pin_attempts+1,5)
      WHERE id=${row.id}::uuid AND consumed_at IS NULL AND cancelled_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP AND failed_pin_attempts < 5`;
  }
  return matches;
}

export async function submitConsent(input: {
  token: string; pin?: string; checked: boolean; customerName: string; staff?: ConsentStaff;
}) {
  assertSmsConsentDev();
  if (!TOKEN_RE.test(input.token) ||
    (input.checked && input.customerName.trim().length < 2) || input.customerName.trim().length > 120) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const row = await findSession(input.token);
  if (!active(row) || !row) return { ok: false as const, reason: "expired" as const };
  if (row.method === "IN_SHOP_IPAD" &&
    (input.staff?.shopId !== row.shopId || input.staff?.userId !== row.createdByUserId))
    return { ok: false as const, reason: "invalid" as const };
  if (row.method === "IN_SHOP_QR" && !/^\d{6}$/.test(input.pin ?? ""))
    return { ok: false as const, reason: "invalid" as const };

  // Lock the session and customer together: once used, even concurrent submissions fail.
  return prisma.$transaction(async tx => {
    const sessions = await tx.$queryRaw<SessionRow[]>`
      SELECT s.id, s.shop_id AS "shopId", s.customer_id AS "customerId",
      s.phone_e164 AS phone, s.token_sha256 AS "tokenHash", s.staff_pin_sha256 AS "pinHash",
      s.created_by_user_id AS "createdByUserId", s.disclosure_version AS version, s.collection_method AS method, s.expires_at AS "expiresAt", s.consumed_at AS "consumedAt",
      s.cancelled_at AS "cancelledAt", s.failed_pin_attempts AS attempts,
      sh.name AS "shopName", c.phone AS "customerPhone", c.archived_at AS "archivedAt"
      FROM sms_consent_sessions s JOIN shops sh ON sh.id=s.shop_id
      JOIN customers c ON c.id=s.customer_id AND c.shop_id=s.shop_id
      WHERE s.id=${row.id}::uuid FOR UPDATE OF s, c`;
    const current = sessions[0];
    if (!current || !active(current)) return { ok: false as const, reason: "expired" as const };
    if (current.method === "IN_SHOP_IPAD" &&
      (input.staff?.shopId !== current.shopId || input.staff?.userId !== current.createdByUserId))
      return { ok: false as const, reason: "invalid" as const };
    if (current.method === "IN_SHOP_QR" &&
      !timingSafeEqual(Buffer.from(current.pinHash, "hex"), Buffer.from(digest(input.pin ?? ""), "hex"))) {
      await tx.$executeRaw`UPDATE sms_consent_sessions SET failed_pin_attempts=LEAST(failed_pin_attempts+1,5)
        WHERE id=${current.id}::uuid`;
      return { ok: false as const, reason: "invalid" as const };
    }
    // An in-flight iPad/QR consent cannot override a STOP received after the session began.
    const activeSuppression = await tx.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM sms_phone_suppressions
        WHERE shop_id=${current.shopId}::uuid AND phone_e164=${current.phone}
          AND cleared_at IS NULL) AS blocked`;
    if (activeSuppression[0]?.blocked) return { ok: false as const, reason: "invalid" as const };
    await tx.$executeRaw`UPDATE sms_consent_sessions SET consumed_at=CURRENT_TIMESTAMP WHERE id=${current.id}::uuid`;
    {
      const decision = input.checked ? "OPT_IN" : "DECLINED";
      await tx.$executeRaw`INSERT INTO sms_consent_events
        (shop_id, customer_id, session_id, phone_e164, event_type, method,
         disclosure_version, disclosure_text, customer_name)
        VALUES (${current.shopId}::uuid, ${current.customerId}::uuid,
          ${current.id}::uuid, ${current.phone}, ${decision}, ${current.method},
          ${SMS_CONSENT_VERSION}, ${smsConsentText(current.shopName)}, ${input.customerName.trim()})`;
    }
    return { ok: true as const, consented: input.checked };
  });
}

export async function getSmsConsentStatus(shopId: string, customerId: string, phoneValue: string | null) {
  const phone = normalizeUsSmsPhone(phoneValue ?? "");
  if (!phone || !uuid.test(shopId) || !uuid.test(customerId)) return "MISSING" as const;
  const rows = await prisma.$queryRaw<Array<{
    eventType: "OPT_IN" | "OPT_OUT" | "DECLINED" | null;
    suppressed: boolean; consentAt: Date | null; consentVersion: string | null;
    declinedAt: Date | null; stoppedAt: Date | null; verifiedStartAt: Date | null;
  }>>`
    SELECT
      (SELECT event_type FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
          AND phone_e164=${phone}
        ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "eventType",
      EXISTS(SELECT 1 FROM sms_phone_suppressions
        WHERE shop_id=${shopId}::uuid AND phone_e164=${phone} AND cleared_at IS NULL) AS suppressed,
      (SELECT occurred_at FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
          AND phone_e164=${phone} AND event_type='OPT_IN' AND method IN ('IN_SHOP_IPAD','IN_SHOP_QR')
        ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "consentAt",
      (SELECT disclosure_version FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
          AND phone_e164=${phone} AND event_type='OPT_IN' AND method IN ('IN_SHOP_IPAD','IN_SHOP_QR')
        ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "consentVersion",
      (SELECT occurred_at FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
          AND phone_e164=${phone} AND event_type='DECLINED'
        ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "declinedAt",
      (SELECT occurred_at FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
          AND phone_e164=${phone} AND event_type='OPT_OUT' AND method='TWILIO_STOP'
        ORDER BY occurred_at DESC,id DESC LIMIT 1) AS "stoppedAt",
      (SELECT created_at FROM sms_inbound_events
        WHERE shop_id=${shopId}::uuid AND phone_e164=${phone}
          AND keyword='START' AND twilio_opt_out_type='START'
        ORDER BY created_at DESC,message_sid DESC LIMIT 1) AS "verifiedStartAt"`;
  const evidence = rows[0];
  if (!evidence) return "MISSING" as const;
  if (evidence.suppressed) return "OPTED_OUT" as const;
  if (evidence.eventType === "OPT_IN") return "CONSENTED" as const;
  if (evidence.eventType === "DECLINED") return "DECLINED" as const;
  if (canRestoreSmsConsent({ ...evidence, latestDecision: evidence.eventType }, SMS_CONSENT_VERSION)) return "CONSENTED" as const;
  return "MISSING" as const;
}

export type ConsentHistoryItem = { id: string; eventType: "OPT_IN" | "OPT_OUT" | "DECLINED" | "PROVIDER_START" | "PROVIDER_RECONSENT";
  method: string; customerName: string | null; phone: string; occurredAt: string; originalConsentId: string | null };

/** The immutable provider START message is the re-subscription audit event.
 * A verified START receives a derived 'restored' label only if we can link
 * it to a qualifying prior iPad/QR OPT_IN on this customer and phone.
 * Never mutate or overwrite the original signed consent decision.
 */
export async function getSmsConsentHistory(shopId: string, customerId: string): Promise<ConsentHistoryItem[]> {
  if (!uuid.test(shopId) || !uuid.test(customerId)) return [];
  const rows = await prisma.$queryRaw<Array<{
    id: string; eventType: ConsentHistoryItem["eventType"]; method: string;
    customerName: string | null; phone: string; occurredAt: Date; originalConsentId: string | null;
  }>>`
    SELECT id, "eventType", method, "customerName", phone, "occurredAt", "originalConsentId" FROM (
      SELECT id::text AS id, event_type AS "eventType", method,
        customer_name AS "customerName", phone_e164 AS phone,
        occurred_at AS "occurredAt", NULL::text AS "originalConsentId"
      FROM sms_consent_events
      WHERE shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid

      UNION ALL

      SELECT ('twilio-start-' || e.message_sid) AS id,
        CASE WHEN prior.id IS NOT NULL
          AND EXISTS (SELECT 1 FROM sms_consent_events stop
            WHERE stop.shop_id=e.shop_id AND stop.customer_id=${customerId}::uuid
              AND stop.phone_e164=e.phone_e164 AND stop.event_type='OPT_OUT' AND stop.method='TWILIO_STOP'
              AND stop.occurred_at > prior.occurred_at AND stop.occurred_at < e.created_at)
          AND NOT EXISTS (SELECT 1 FROM sms_consent_events decline
            WHERE decline.shop_id=e.shop_id AND decline.customer_id=${customerId}::uuid
              AND decline.phone_e164=e.phone_e164 AND decline.event_type='DECLINED'
              AND decline.occurred_at > prior.occurred_at AND decline.occurred_at < e.created_at)
        THEN 'PROVIDER_RECONSENT' ELSE 'PROVIDER_START' END AS "eventType",
        'TWILIO_START' AS method, NULL::text AS "customerName",
        e.phone_e164 AS phone, e.created_at AS "occurredAt",
        prior.id::text AS "originalConsentId"
      FROM sms_inbound_events e
      JOIN customers c ON c.id=${customerId}::uuid AND c.shop_id=e.shop_id
      LEFT JOIN LATERAL (
        SELECT decision.id, decision.occurred_at
        FROM sms_consent_events decision
        WHERE decision.shop_id=e.shop_id AND decision.customer_id=${customerId}::uuid
          AND decision.phone_e164=e.phone_e164 AND decision.event_type='OPT_IN'
          AND decision.method IN ('IN_SHOP_IPAD','IN_SHOP_QR')
          AND decision.disclosure_version=${SMS_CONSENT_VERSION}
          AND decision.occurred_at < e.created_at
        ORDER BY decision.occurred_at DESC, decision.id DESC LIMIT 1
      ) prior ON true
      WHERE e.shop_id=${shopId}::uuid AND e.keyword='START'
        AND e.twilio_opt_out_type='START'
        AND c.archived_at IS NULL
        AND RIGHT(e.phone_e164,10) =
          CASE WHEN LENGTH(regexp_replace(COALESCE(c.phone,''), '[^0-9]', '', 'g')) = 11
            THEN RIGHT(regexp_replace(COALESCE(c.phone,''), '[^0-9]', '', 'g'),10)
            ELSE regexp_replace(COALESCE(c.phone,''), '[^0-9]', '', 'g') END
    ) history
    ORDER BY "occurredAt" DESC, id DESC LIMIT 12`;
  return rows.map(r => ({ ...r, phone: masked(r.phone), occurredAt: r.occurredAt.toISOString() }));
}

export async function getSmsConsentSessionProgress(shopId: string, customerId: string, sessionId: string) {
  if (![shopId, customerId, sessionId].every(v => uuid.test(v))) return "INVALID" as const;
  const rows = await prisma.$queryRaw<Array<{consumedAt: Date | null; cancelledAt: Date | null; expiresAt: Date}>>`
    SELECT consumed_at AS "consumedAt", cancelled_at AS "cancelledAt", expires_at AS "expiresAt"
    FROM sms_consent_sessions WHERE id=${sessionId}::uuid AND shop_id=${shopId}::uuid
    AND customer_id=${customerId}::uuid LIMIT 1`;
  const row = rows[0];
  return !row ? "INVALID" as const : row.consumedAt ? "COMPLETED" as const :
    row.cancelledAt ? "CANCELLED" as const : row.expiresAt.getTime() <= Date.now() ?
    "EXPIRED" as const : "PENDING" as const;
}

export async function cancelSmsConsentSession(shopId: string, customerId: string, sessionId: string) {
  if (![shopId, customerId, sessionId].every(v => uuid.test(v))) return;
  await prisma.$executeRaw`UPDATE sms_consent_sessions SET cancelled_at=CURRENT_TIMESTAMP
    WHERE id=${sessionId}::uuid AND shop_id=${shopId}::uuid AND customer_id=${customerId}::uuid
    AND consumed_at IS NULL AND cancelled_at IS NULL`;
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

/** STOP suppresses the normalized number across all customer records in this shop. */
export async function recordSmsStop(shopId: string, phone: string) {
  const normalized = normalizeUsSmsPhone(phone);
  if (!uuid.test(shopId) || !normalized) return;
  const matches = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM customers
    WHERE shop_id=${shopId}::uuid AND (
      CASE WHEN length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
        THEN right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
        ELSE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') END
        = right(${normalized}, 10)
      OR
      CASE WHEN length(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g')) = 11
        THEN right(regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g'), 10)
        ELSE regexp_replace(coalesce(phone2, ''), '[^0-9]', '', 'g') END
        = right(${normalized}, 10)
    )`;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO sms_phone_suppressions(shop_id,phone_e164,source)
      VALUES(${shopId}::uuid,${normalized},'TWILIO_STOP') ON CONFLICT (shop_id, phone_e164)
      DO UPDATE SET suppressed_at=CURRENT_TIMESTAMP, cleared_at=NULL, source='TWILIO_STOP'`;
    // Only record a new customer history entry for the first received STOP.
    for (const customer of matches) {
      const previous = await tx.$queryRaw<Array<{ eventType: string }>>`
        SELECT event_type AS "eventType" FROM sms_consent_events
        WHERE shop_id=${shopId}::uuid AND customer_id=${customer.id}::uuid
          AND phone_e164=${normalized}
        ORDER BY occurred_at DESC, id DESC LIMIT 1`;
      if (previous[0]?.eventType !== "OPT_OUT") {
        await tx.$executeRaw`
          INSERT INTO sms_consent_events(shop_id,customer_id,phone_e164,event_type,method)
          VALUES (${shopId}::uuid,${customer.id}::uuid,${normalized},'OPT_OUT','TWILIO_STOP')`;
      }
    }
  });
}

/** A Twilio-confirmed START removes only the transport suppression.
 * It does NOT create customer consent; the original STOP evidence is retained.
 * Call exclusively after authenticating the Twilio webhook and verifying OptOutType=START.
 */
export async function recordSmsStart(shopId: string, phone: string) {
  const normalized = normalizeUsSmsPhone(phone);
  if (!uuid.test(shopId) || !normalized) return;
  await prisma.$executeRaw`
    UPDATE sms_phone_suppressions SET cleared_at=CURRENT_TIMESTAMP
    WHERE shop_id=${shopId}::uuid AND phone_e164=${normalized} AND cleared_at IS NULL`;
}
