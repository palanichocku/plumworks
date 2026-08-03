export type SmtpEmailAttachment = { filename: string; content: Buffer; contentType?: string };
export type SmtpEmailMessage = { to: string; subject: string; text: string; attachments: SmtpEmailAttachment[] };
export type SmtpEmailSendResult = { ok: true } | { ok: false; message: string };

export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const DEFAULT_EMAIL_FROM = "Car Doc <reports@plumworksapp.com>";

export function isEmailAttachmentSizeAllowed(size: number) {
  return Number.isSafeInteger(size) && size >= 0 && size <= MAX_EMAIL_ATTACHMENT_BYTES;
}

export async function sendResendSmtpMessage(
  message: SmtpEmailMessage,
  dependencies: {
    apiKey?: string;
    fromAddress?: string;
    sendMail: (message: SmtpEmailMessage & { from: string }) => Promise<unknown>;
    logError?: (message: string) => void;
  },
): Promise<SmtpEmailSendResult> {
  const apiKey = dependencies.apiKey?.trim();
  const fromAddress = dependencies.fromAddress?.trim() || DEFAULT_EMAIL_FROM;

  if (!apiKey) {
    dependencies.logError?.("Document email configuration is missing: RESEND_API_KEY");
    return { ok: false, message: "Email delivery is not configured." };
  }

  if (message.attachments.some((attachment) => !isEmailAttachmentSizeAllowed(attachment.content.byteLength))) {
    return { ok: false, message: "The PDF attachment is too large to email." };
  }

  try {
    await dependencies.sendMail({ from: fromAddress, ...message });
    return { ok: true };
  } catch {
    dependencies.logError?.("Resend SMTP delivery failed.");
    return { ok: false, message: "Email delivery failed. Please try again." };
  }
}
