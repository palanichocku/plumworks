"use server";

import { headers } from "next/headers";
import { getCurrentMembership } from "@/lib/data/membership";
import { getRepairOrderDocumentForShop } from "@/lib/repair-order-document";
import { deliverRepairOrderEmail } from "@/lib/email/repair-order-email";
import { normalizeEmailRecipient } from "@/lib/email/document-email-core";
import { repairOrderEmailMessage, type RepairOrderEmailState } from "@/lib/email/repair-order-email-core";
import { hasPermission } from "@/lib/permissions";
import { getRepairOrderAuthorizationSummaryForShop } from "@/lib/authorization/repair-order-evidence";
import {
  createRepairOrderEmailAuthorizationRequest,
  markRepairOrderAuthorizationRequestSent,
  revokeRepairOrderAuthorizationRequest,
} from "@/lib/authorization/remote-repair-order-authorization";

async function authorizationOrigin() {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) throw new Error("Public authorization origin is unavailable.");
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

export async function sendRepairOrderEmailAction(_state: RepairOrderEmailState, formData: FormData): Promise<RepairOrderEmailState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const recipient = normalizeEmailRecipient(String(formData.get("recipient") ?? ""));
  if (!recipient) return { status: "error", message: "Enter a valid recipient email address." };

  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return { status: "error", message: "You do not have permission to email this Repair Order." };
  if (!hasPermission(membership.role, "edit_draft_repair_order")) return { status: "error", message: "You do not have permission to email this Repair Order." };
  const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
  if (!model) return { status: "error", message: "Repair Order not found for this shop." };
  if (model.status === "void") return { status: "error", message: "Voided Repair Orders cannot be emailed." };

  const authorization = await getRepairOrderAuthorizationSummaryForShop(membership.shopId, repairOrderId);
  if (authorization?.status === "AUTHORIZED") {
    const result = await deliverRepairOrderEmail(model, recipient);
    return result.ok
      ? { status: "success", message: "Repair Order emailed successfully. This revision is already authorized." }
      : { status: "error", message: result.message };
  }

  let request: Awaited<ReturnType<typeof createRepairOrderEmailAuthorizationRequest>> | null = null;
  try {
    request = await createRepairOrderEmailAuthorizationRequest({ shopId: membership.shopId, repairOrderId, recipientEmail: recipient });
    const origin = await authorizationOrigin();
    const authorizationUrl = `${origin}/authorize/repair-order/${encodeURIComponent(request.token)}`;
    const approvalMessage = repairOrderEmailMessage(model, recipient, authorizationUrl);
    const result = await deliverRepairOrderEmail(model, recipient, { authorizationUrl });
    if (!result.ok) {
      await revokeRepairOrderAuthorizationRequest(request.requestId);
      return { status: "error", message: result.message };
    }
    await markRepairOrderAuthorizationRequestSent(request.requestId, approvalMessage.subject);
    return { status: "success", message: "Repair Order emailed with a secure customer approval link." };
  } catch {
    if (request) await revokeRepairOrderAuthorizationRequest(request.requestId).catch(() => undefined);
    return { status: "error", message: "The secure approval request could not be sent. Please try again." };
  }
}
