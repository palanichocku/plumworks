import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { RepairOrderDocumentPDF } from "@/components/pdf/repair-order-document-pdf";
import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";
import { sendGmailMessage } from "@/lib/email/gmail";
import { sendPdfDocumentEmail } from "@/lib/email/document-email";
import { repairOrderEmailMessage } from "@/lib/email/repair-order-email-core";

export async function deliverRepairOrderEmail(model: RepairOrderDocumentModel, recipient: string, dependencies: {
  renderPdf?: (model: RepairOrderDocumentModel) => Promise<Buffer>;
  sendEmail?: typeof sendGmailMessage;
} = {}) {
  let pdf: Buffer;
  try {
    pdf = await (dependencies.renderPdf ?? (async (document) => Buffer.from(await renderToBuffer(<RepairOrderDocumentPDF model={document} />))))(model);
  } catch {
    return { ok: false as const, message: "The Repair Order PDF could not be generated. Please try again." };
  }
  return sendPdfDocumentEmail({ message: repairOrderEmailMessage(model, recipient), attachmentFilename: model.filename, pdfBuffer: pdf }, dependencies.sendEmail);
}
