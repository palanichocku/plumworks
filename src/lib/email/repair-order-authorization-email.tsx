import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { RepairOrderDocumentPDF } from "@/components/pdf/repair-order-document-pdf";
import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";
import { repairOrderEmailMessage } from "@/lib/email/repair-order-email-core";
import { sendResendEmail } from "@/lib/email/resend-core";

export async function deliverRepairOrderAuthorizationEmail(
  model: RepairOrderDocumentModel,
  recipient: string,
  authorizationUrl: string,
) {
  let pdf: Buffer;
  try {
    pdf = Buffer.from(await renderToBuffer(<RepairOrderDocumentPDF model={model} />));
  } catch {
    return { ok: false as const, message: "The Repair Order PDF could not be generated. Please try again." };
  }

  const message = repairOrderEmailMessage(model, recipient, authorizationUrl);
  const result = await sendResendEmail({
    to: recipient,
    subject: message.subject,
    text: message.text,
    attachments: [{ filename: model.filename, content: pdf.toString("base64") }],
  }, {
    from: process.env.TRANSACTIONAL_EMAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim(),
  });

  return result.ok
    ? { ok: true as const, id: result.id, subject: message.subject }
    : { ok: false as const, message: result.message };
}
