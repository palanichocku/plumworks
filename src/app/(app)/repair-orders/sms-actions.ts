"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { getRepairOrderDocumentForShop } from "@/lib/repair-order-document";
import { isRepairOrderReadyForAuthorization } from "@/lib/authorization/repair-order-readiness";
import { getRepairOrderAuthorizationSummaryForShop } from "@/lib/authorization/repair-order-evidence";
import { hasPermission } from "@/lib/permissions";
import { assertDevelopmentSmsEnabled, createDevelopmentSmsProvider, isProductionSmsSendingEnabled } from "@/lib/messaging/sms";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";
import { isDevelopmentSmsRecipientAllowed } from "@/lib/messaging/dev-recipient-allowlist";
import { assertSmsRecipientConsented } from "@/lib/messaging/sms-consent";
import {
  createRepairOrderSmsAuthorizationRequest,
  markRepairOrderSmsRequestAccepted,
  revokeRepairOrderAuthorizationRequest,
} from "@/lib/authorization/remote-repair-order-authorization";

export type SmsAuthorizationState = { status: "idle" | "success" | "error"; message: string; link?: string; requestId?: string };
const error = (message: string): SmsAuthorizationState => ({ status: "error", message });

function checkSmsSetup() {
  assertDevelopmentSmsEnabled();
  const production = process.env.VERCEL_ENV === "production";
  const origin = (production ? process.env.SMS_APPROVAL_ORIGIN : process.env.SMS_DEV_APPROVAL_ORIGIN)?.trim();
  // Never use the production website as a development-approval URL.
  if (!origin) throw new Error("Configure a verified SMS approval URL for this environment.");
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Development approval origin must use HTTPS or localhost.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Development approval origin must be a plain website origin.");
  }
  if (production && url.origin !== "https://app.subbuscardoc.com") {
    throw new Error("Production authorization links must use the approved app origin.");
  }
  if (!production && (url.hostname === "subbuscardoc.com" || url.hostname === "www.subbuscardoc.com" ||
      url.hostname === "app.subbuscardoc.com" || url.hostname === "prod.subbuscardoc.com")) {
    throw new Error("Production shop domains may not be used for SMS development.");
  }
  return url.origin;
}

export async function getRepairOrderSmsRecipientAction(repairOrderId: string) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_draft_repair_order")) return "";
  const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
  if (!model || model.status === "void") return "";
  return model.customer.phone ?? "";
}

export async function sendRepairOrderSmsAuthorizationAction(
  _previous: SmsAuthorizationState,
  formData: FormData,
): Promise<SmsAuthorizationState> {
  let origin: string;
  try {
    origin = checkSmsSetup();
  } catch {
    return error("SMS sending is disabled or its approval URL is not configured.");
  }

  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const recipientPhone = normalizeUsSmsPhone(String(formData.get("recipientPhone") ?? ""));

  // Explicit consent checkbox applies to this developer-only test, not commercial customer opt-in.
  const production = isProductionSmsSendingEnabled();
  if (!production && formData.get("testConsent") !== "yes") return error("Confirm this is your own opted-in development test number.");
  if (!recipientPhone || (!production && !isDevelopmentSmsRecipientAllowed(recipientPhone))) {
    return error("Enter a valid US phone number permitted for this environment.");
  }
  const sender = normalizeUsSmsPhone(process.env.TWILIO_SMS_FROM ?? "");
  if (!sender) return error("Configure the Twilio development sender number.");

  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_draft_repair_order")) {
    return error("You do not have permission to send SMS estimates.");
  }

  // Per-shop spend guard: configurable accepted SMS requests in a rolling 24-hour window.
  // Invalid or missing values fall back to 5; keep a finite upper bound even in Dev.
  // Additional provider-side rate limits should be added before commercial launch.
  const configuredLimit = production ? process.env.SMS_PROD_DAILY_LIMIT : process.env.SMS_DEV_DAILY_LIMIT;
  const parsedLimit = configuredLimit && /^\d+$/.test(configuredLimit) ? Number(configuredLimit) : NaN;
  const dailyLimit = Number.isSafeInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100 ? parsedLimit : (production ? 25 : 5);
  const { prisma } = await import("@/lib/prisma");
  const counts = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total FROM authorization_requests
    WHERE shop_id = ${membership.shopId}::uuid
      AND channel = 'SMS'
      AND sent_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
  `;
  if (Number(counts[0]?.total ?? 0) >= dailyLimit) {
    return error(`SMS limit reached: ${dailyLimit} accepted messages per shop per 24 hours.`);
  }

  const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
  if (!model || model.status === "void") return error("Repair Order not found or voided.");
  if (!(await isRepairOrderReadyForAuthorization(membership.shopId, repairOrderId))) {
    return error("Save the Repair Order before sending an authorization request.");
  }
  const summary = await getRepairOrderAuthorizationSummaryForShop(membership.shopId, repairOrderId);
  if (summary?.status === "AUTHORIZED") return error("This Repair Order revision is already authorized.");

  try {
    await assertSmsRecipientConsented(membership.shopId, model.customer.id, recipientPhone);
  } catch {
    return error("SMS is blocked: valid customer consent for this mobile number is missing or the number has opted out.");
  }

  // Trial accounts may reject custom text. Do not substitute template messages: they omit
  // the unique authorization link and would incorrectly represent the approval workflow.
  let request: Awaited<ReturnType<typeof createRepairOrderSmsAuthorizationRequest>> | null = null;
  let accepted = false;
  try {
    const provider = createDevelopmentSmsProvider();
    request = await createRepairOrderSmsAuthorizationRequest({
      shopId: membership.shopId, repairOrderId, recipientPhone,
    });
    const link = `${origin}/authorize/repair-order/${encodeURIComponent(request.token)}`;
    const body = `${model.shop.name}: Review and authorize estimate #${model.repairOrderNumber}: ${link} Reply STOP to opt out.`;
    await assertSmsRecipientConsented(membership.shopId, model.customer.id, recipientPhone);
    const callbackBase = process.env.SMS_TWILIO_STATUS_URL;
    if (callbackBase !== (production ? "https://app.subbuscardoc.com/api/sms/status" : "https://dev.subbuscardoc.com/api/sms/status")) {
      throw new Error("Twilio status callback is not configured.");
    }
    const statusCallbackUrl = `${callbackBase}?requestId=${encodeURIComponent(request.requestId)}`;
    const response = await provider.send({ to: recipientPhone, from: sender, body, statusCallbackUrl });
    if (!response.ok) {
      await revokeRepairOrderAuthorizationRequest(request.requestId);
      return error(`Twilio did not accept the custom estimate SMS (code: ${response.errorCode}). Trial-template limitations may apply.`);
    }
    accepted = true;
    await markRepairOrderSmsRequestAccepted(request.requestId, response.providerMessageId);
    return { status: "success", message: "Estimate SMS accepted by Twilio. Delivery is not yet confirmed.", requestId: request.requestId };
  } catch {
    if (request && !accepted) await revokeRepairOrderAuthorizationRequest(request.requestId).catch(() => undefined);
    return error(accepted
      ? "Twilio accepted the SMS, but PlumWorks could not save delivery state. Check Twilio logs before retrying."
      : "The SMS could not be sent. Check configuration and try again.");
  }
}


/**
 * Local-development-only manual approval-link test. Never contacts Twilio and
 * never sets sent_at; it is NOT evidence that an SMS was delivered.
 * Requires an explicit local opt-in separate from SMS_DEV_SEND_ENABLED.
 */
export async function generateRepairOrderSmsTestLinkAction(
  _previous: SmsAuthorizationState,
  formData: FormData,
): Promise<SmsAuthorizationState> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VERCEL_ENV ||
    process.env.SMS_DEV_LINK_TEST_ENABLED !== "true" ||
    process.env.NEXT_PUBLIC_SMS_DEV_UI_ENABLED !== "true"
  ) return error("Manual SMS test links are available only in opted-in local Development.");

  let origin: string;
  try {
    const raw = process.env.SMS_DEV_APPROVAL_ORIGIN?.trim();
    if (!raw) throw new Error("missing origin");
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
        !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) ||
        !url.hostname.startsWith("plumworks-cardoc-")) throw new Error("invalid preview origin");
    origin = url.origin;
  } catch {
    return error("Set SMS_DEV_APPROVAL_ORIGIN to the verified Dev Vercel Preview HTTPS origin.");
  }

  const recipientPhone = normalizeUsSmsPhone(String(formData.get("recipientPhone") ?? ""));
  if (formData.get("testConsent") !== "yes" ||
      !recipientPhone || !isDevelopmentSmsRecipientAllowed(recipientPhone)) {
    return error("Confirm your own allowlisted test phone and consent first.");
  }

  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  try {
    const { user, membership } = await getCurrentMembership();
    if (!user || !membership || !hasPermission(membership.role, "edit_draft_repair_order")) {
      return error("You do not have permission to generate this test link.");
    }
    const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
    if (!model || model.status === "void" ||
        !(await isRepairOrderReadyForAuthorization(membership.shopId, repairOrderId))) {
      return error("Use a saved, active Development Repair Order.");
    }
    const summary = await getRepairOrderAuthorizationSummaryForShop(membership.shopId, repairOrderId);
    if (summary?.status === "AUTHORIZED") return error("This Repair Order revision is already authorized.");

    // Creating a new request supersedes prior PENDING requests for the order.
    // The generated token is only returned to this authenticated local UI.
    const request = await createRepairOrderSmsAuthorizationRequest({
      shopId: membership.shopId, repairOrderId, recipientPhone,
    });
    return {
      status: "success",
      message: "Development SMS-channel approval link generated. No text was sent.",
      link: `${origin}/authorize/repair-order/${encodeURIComponent(request.token)}`,
    };
  } catch {
    return error("Could not generate the Dev approval link. Confirm the Dev migration and saved Repair Order.");
  }
}
