import "server-only";

import { sendGmailMessage, type EmailSendResult } from "@/lib/email/gmail";
import type { DocumentEmailMessage } from "@/lib/email/document-email-core";

export async function sendPdfDocumentEmail({
  message,
  attachmentFilename,
  pdfBuffer,
}: {
  message: DocumentEmailMessage;
  attachmentFilename: string;
  pdfBuffer: Buffer;
}, sendEmail: typeof sendGmailMessage = sendGmailMessage): Promise<EmailSendResult> {
  return sendEmail({
    ...message,
    attachments: [{ filename: attachmentFilename, content: pdfBuffer, contentType: "application/pdf" }],
  });
}
