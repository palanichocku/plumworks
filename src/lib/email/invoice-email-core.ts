import type { InvoiceDocumentModel } from "@/lib/invoice-document";

export type InvoiceEmailState = { status: "idle" | "success" | "error"; message?: string };

export function normalizeEmailRecipient(value: string) {
  const recipient = value.trim().toLowerCase();
  if (!recipient || recipient.length > 254 || /[\r\n]/.test(recipient) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  return recipient;
}

export function safeEmailHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function invoiceEmailMessage(model: InvoiceDocumentModel, recipient: string) {
  const invoiceNumber = safeEmailHeader(model.invoiceNumber);
  const shopName = safeEmailHeader(model.shop.name);
  return {
    to: recipient,
    subject: `Invoice ${invoiceNumber} from ${shopName}`,
    text: `Hello,\n\nAttached is your invoice ${invoiceNumber} from ${shopName}.\n\nThank you for your business.`,
  };
}
