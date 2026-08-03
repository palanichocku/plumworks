import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";
import { documentEmailMessage, type DocumentEmailState } from "@/lib/email/document-email-core";

export type RepairOrderEmailState = DocumentEmailState;

export function repairOrderEmailMessage(model: RepairOrderDocumentModel, recipient: string) {
  return documentEmailMessage({
    documentType: "Repair Order",
    documentNumber: model.repairOrderNumber,
    shopName: model.shop.name,
    recipient,
  });
}
