import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";
import { documentEmailMessage, type DocumentEmailState } from "@/lib/email/document-email-core";

export type RepairOrderEmailState = DocumentEmailState;

export function repairOrderEmailMessage(model: RepairOrderDocumentModel, recipient: string, authorizationUrl?: string) {
  const message = documentEmailMessage({
    documentType: "Repair Order",
    documentNumber: model.repairOrderNumber,
    shopName: model.shop.name,
    recipient,
  });
  if (!authorizationUrl) return message;
  return {
    ...message,
    subject: `Approval requested: ${message.subject}`,
    text: `${message.text}\n\nPlease review this exact Repair Order and record your approval or decline here:\n${authorizationUrl}\n\nFor your security, this approval link expires and is invalidated if the Repair Order changes.`,
  };
}
