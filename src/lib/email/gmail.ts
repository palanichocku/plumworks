import "server-only";

import nodemailer from "nodemailer";

export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export type GmailAttachment = { filename: string; content: Buffer; contentType?: string };
export type GmailMessage = { to: string; subject: string; text: string; attachments: GmailAttachment[] };
export type GmailSendResult = { ok: true } | { ok: false; message: string };

export function isEmailAttachmentSizeAllowed(size: number) {
  return Number.isSafeInteger(size) && size >= 0 && size <= MAX_EMAIL_ATTACHMENT_BYTES;
}

export async function sendGmailMessage(message: GmailMessage): Promise<GmailSendResult> {
  const user = process.env.EMAIL_USER?.trim();
  const password = process.env.EMAIL_PASSWORD;
  if (!user || !password) return { ok: false, message: "Email delivery is not configured." };
  if (message.attachments.some((attachment) => !isEmailAttachmentSizeAllowed(attachment.content.byteLength))) {
    return { ok: false, message: "The PDF attachment is too large to email." };
  }
  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
    await transporter.sendMail({ from: user, ...message });
    return { ok: true };
  } catch {
    return { ok: false, message: "Email delivery failed. Please try again." };
  }
}
