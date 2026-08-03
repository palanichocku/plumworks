"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { getRepairOrderDocumentForShop } from "@/lib/repair-order-document";
import { deliverRepairOrderEmail } from "@/lib/email/repair-order-email";
import { normalizeEmailRecipient } from "@/lib/email/document-email-core";
import type { RepairOrderEmailState } from "@/lib/email/repair-order-email-core";

export async function sendRepairOrderEmailAction(_state: RepairOrderEmailState, formData: FormData): Promise<RepairOrderEmailState> {
  const repairOrderId = String(formData.get("repairOrderId") ?? "");
  const recipient = normalizeEmailRecipient(String(formData.get("recipient") ?? ""));
  if (!recipient) return { status: "error", message: "Enter a valid recipient email address." };

  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return { status: "error", message: "You do not have permission to email this Repair Order." };
  const model = await getRepairOrderDocumentForShop(repairOrderId, membership.shopId);
  if (!model) return { status: "error", message: "Repair Order not found for this shop." };

  const result = await deliverRepairOrderEmail(model, recipient);
  return result.ok
    ? { status: "success", message: "Repair Order emailed successfully." }
    : { status: "error", message: result.message };
}
