"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { getRepairOrderDocumentForShop } from "@/lib/repair-order-document";
import { isRepairOrderReadyForAuthorization } from "@/lib/authorization/repair-order-readiness";
import { getRepairOrderAuthorizationSummaryForShop } from "@/lib/authorization/repair-order-evidence";
import { hasPermission } from "@/lib/permissions";
import { assertDevelopmentSmsEnabled, createDevelopmentSmsProvider } from "@/lib/messaging/sms";
import { normalizeUsSmsPhone } from "@/lib/messaging/phone";
import {
  createRepairOrderSmsAuthorizationRequest,
  markRepairOrderSmsRequestAccepted,
  revokeRepairOrderAuthorizationRequest,
} from "@/lib/authorization/remote-repair-order-authorization";

export type SmsAuthorizationState = { status: "idle" | "success" | "error"; message: string; link?: string };
const error = (message: string): SmsAuthorizationState => ({ status: "error", message });

function checkSmsSetup() {
  assertDevelopmentSmsEnabled();
  const origin = process.env.SMS_DEV_APPROVAL_ORIGIN?.trim();
  // Never use the production website as a development-approval URL.
  if (!origin) throw new Error("Configure SMS_DEV_APPROVAL_ORIGIN for your reachable Dev instance.");
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("Development approval origin must use HTTPS or localhost.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Development approval origin must be a plain website origin.");
  }
  if (url.hostname === "subbuscardoc.com" || url.hostname === "www.subbuscardoc.com" ||
      url.hostname === "app.subbuscardoc.com" || url.hostname === "prod.subbuscardoc.com") {
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
    return error("SMS Dev sending is disabled or its approval URL is not configured.");
  }

  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const recipientPhone = normalizeUsSmsPhone(String(formData.get("recipientPhone") ?? ""));
  const allowed = normalizeUsSmsPhone(process.env.SMS_DEV_ALLOWED_TO ?? "");

  // Explicit consent checkbox applies to this developer-only test, not commercial customer opt-in.
  if (formData.get("testConsent") !== "yes") return error("Confirm this is your own opted-in development test number.");
  if (!allowed || !recipientPhone || recipientPhone !== allowed) {
    return error("Enter a valid US phone number matching your approved Dev test phone.");
  }
  const sender = process.env.TWILIO_SMS_FROM?.trim();
  if (!sender) return error("Configure the Twilio development sender number.");

  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_draft_repair_order")) {
    return error("You do not have permission to send SMS estimates.");
  }

  // Development spend/abuse guard: at most 5 accepted SMS requests per shop/day.
  // Additional provider-side rate limits should be added before commercial launch.
  const { prisma } = await import("@/lib/prisma");
  const counts = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total FROM authorization_requests
    WHERE shop_id = ${membership.shopId}::uuid
      AND channel = 'SMS'
      AND sent_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
  `;
  if (Number(counts[0]?.total ?? 0) >= 5) {
    return error("Dev SMS limit reached: five accepted messages per shop per 24 hours.");
  }

  const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
  if (!model || model.status === "void") return error("Repair Order not found or voided.");
  if (!(await isRepairOrderReadyForAuthorization(membership.shopId, repairOrderId))) {
    return error("Save the Repair Order before sending an authorization request.");
  }
  const summary = await getRepairOrderAuthorizationSummaryForShop(membership.shopId, repairOrderId);
  if (summary?.status === "AUTHORIZED") return error("This Repair Order revision is already authorized.");

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
    const response = await provider.send({ to: recipientPhone, from: sender, body });
    if (!response.ok) {
      await revokeRepairOrderAuthorizationRequest(request.requestId);
      return error(`Twilio did not accept the custom estimate SMS (code: ${response.errorCode}). Trial-template limitations may apply.`);
    }
    accepted = true;
    await markRepairOrderSmsRequestAccepted(request.requestId, response.providerMessageId);
    return { status: "success", message: "Estimate SMS accepted by Twilio. Check your test phone; delivery is not yet confirmed." };
  } catch {
    if (request && !accepted) await revokeRepairOrderAuthorizationRequest(request.requestId).catch(() => undefined);
    return error(accepted
      ? "Twilio accepted the SMS, but PlumWorks could not save delivery state. Check Twilio logs before retrying."
      : "The development SMS could not be sent. Check your Dev configuration and try again.");
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
        !/^[a-z0-9-]+\\.vercel\\.app$/.test(url.hostname) ||
        !url.hostname.startsWith("plumworks-cardoc-")) throw new Error("invalid preview origin");
    origin = url.origin;
  } catch {
    return error("Set SMS_DEV_APPROVAL_ORIGIN to the verified Dev Vercel Preview HTTPS origin.");
  }

  const allowed = normalizeUsSmsPhone(process.env.SMS_DEV_ALLOWED_TO ?? "");
  const recipientPhone = normalizeUsSmsPhone(String(formData.get("recipientPhone") ?? ""));
  if (formData.get("testConsent") !== "yes" ||
      !allowed || !recipientPhone || allowed !== recipientPhone) {
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
