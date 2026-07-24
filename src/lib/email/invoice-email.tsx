import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocumentPDF } from "@/components/pdf/invoice-document-pdf";
import type { InvoiceDocumentModel } from "@/lib/invoice-document";
import { sendGmailMessage } from "@/lib/email/gmail";
import { invoiceEmailMessage } from "@/lib/email/invoice-email-core";

export async function deliverInvoiceEmail(model: InvoiceDocumentModel, recipient: string, dependencies: {
  renderPdf?: (model: InvoiceDocumentModel) => Promise<Buffer>;
  sendEmail?: typeof sendGmailMessage;
} = {}) {
  let pdf: Buffer;
  try {
    pdf = await (dependencies.renderPdf ?? (async (document) => Buffer.from(await renderToBuffer(<InvoiceDocumentPDF model={document} />))))(model);
  } catch {
    return { ok: false as const, message: "The Invoice PDF could not be generated. Please try again." };
  }
  return (dependencies.sendEmail ?? sendGmailMessage)({
    ...invoiceEmailMessage(model, recipient),
    attachments: [{ filename: model.filename, content: pdf, contentType: "application/pdf" }],
  });
}
