export type DocumentEmailState = { status: "idle" | "success" | "error"; message?: string };

export type DocumentEmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export function normalizeEmailRecipient(value: string) {
  const recipient = value.trim().toLowerCase();
  if (!recipient || recipient.length > 254 || /[\r\n]/.test(recipient) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return null;
  return recipient;
}

export function safeEmailHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export function documentEmailMessage({
  documentType,
  documentNumber,
  shopName,
  recipient,
}: {
  documentType: "Invoice" | "Repair Order";
  documentNumber: string;
  shopName: string;
  recipient: string;
}): DocumentEmailMessage {
  const safeNumber = safeEmailHeader(documentNumber);
  const safeShopName = safeEmailHeader(shopName);
  const documentName = documentType.toLowerCase();
  return {
    to: recipient,
    subject: `${documentType} ${safeNumber} from ${safeShopName}`,
    text: `Hello,\n\nAttached is your ${documentName} ${safeNumber} from ${safeShopName}.\n\nThank you for your business.`,
  };
}
