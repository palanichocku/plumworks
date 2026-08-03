import type { InvoiceDocumentModel } from "@/lib/invoice-document";
import {
  documentEmailMessage,
  normalizeEmailRecipient,
  safeEmailHeader,
  type DocumentEmailState,
} from "./document-email-core.ts";

export type InvoiceEmailState = DocumentEmailState;
export { normalizeEmailRecipient, safeEmailHeader };

export function invoiceEmailMessage(model: InvoiceDocumentModel, recipient: string) {
  return documentEmailMessage({ documentType: "Invoice", documentNumber: model.invoiceNumber, shopName: model.shop.name, recipient });
}
