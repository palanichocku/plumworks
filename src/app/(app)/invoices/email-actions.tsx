"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { getInvoiceDocumentForShop } from "@/lib/invoice-document";
import { deliverInvoiceEmail } from "@/lib/email/invoice-email";
import { normalizeEmailRecipient, type InvoiceEmailState } from "@/lib/email/invoice-email-core";

export async function sendInvoiceEmailAction(_state: InvoiceEmailState, formData: FormData): Promise<InvoiceEmailState> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const recipient = normalizeEmailRecipient(String(formData.get("recipient") ?? ""));
  if (!recipient) return { status: "error", message: "Enter a valid recipient email address." };

  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return { status: "error", message: "You do not have permission to email this Invoice." };
  const model = await getInvoiceDocumentForShop(invoiceId, membership.shopId);
  if (!model) return { status: "error", message: "Invoice not found for this shop." };

  const result = await deliverInvoiceEmail(model, recipient);
  return result.ok
    ? { status: "success", message: "Invoice emailed successfully." }
    : { status: "error", message: result.message };
}
