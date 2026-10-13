"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { recordInvoiceDeliverySignatures } from "@/lib/authorization/invoice-signature-evidence";

export type InvoiceSignatureActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function headerIp(requestHeaders: Headers) {
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || requestHeaders.get("x-real-ip")?.trim() || null;
}

export async function recordInvoiceDeliverySignaturesAction(
  _state: InvoiceSignatureActionState,
  formData: FormData,
): Promise<InvoiceSignatureActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    const requestHeaders = await headers();
    await recordInvoiceDeliverySignatures({
      invoiceId,
      customerName: String(formData.get("customerName") ?? ""),
      customerSignatureData: String(formData.get("customerSignatureData") ?? ""),
      shopRepresentativeName: String(formData.get("shopRepresentativeName") ?? ""),
      shopRepresentativeSignatureData: String(formData.get("shopRepresentativeSignatureData") ?? ""),
      customerConsentAccepted: formData.get("customerConsentAccepted") === "on",
      shopConsentAccepted: formData.get("shopConsentAccepted") === "on",
      ipAddress: headerIp(requestHeaders),
      userAgent: requestHeaders.get("user-agent"),
    });
    revalidatePath(`/invoices/${invoiceId}`);
    return { status: "success", message: "Customer and shop representative signatures were recorded." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Delivery signatures could not be recorded." };
  }
}
