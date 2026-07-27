import "server-only";

import nodemailer from "nodemailer";

export const MAX_EMAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export type EmailAttachment = { filename: string; content: Buffer; contentType?: string };
export type EmailMessage = { to: string; subject: string; text: string; attachments: EmailAttachment[] };
export type EmailSendResult = { ok: true } | { ok: false; message: string };

export function isEmailAttachmentSizeAllowed(size: number) {
  return Number.isSafeInteger(size) && size >= 0 && size <= MAX_EMAIL_ATTACHMENT_BYTES;
}

export async function sendGmailMessage(message: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.EMAIL_FROM?.trim() || "Car Doc<reports@plumworksapp.com>";

  if (!apiKey) {
    return { ok: false, message: "Email delivery is not configured." };
  }

  if (message.attachments.some((attachment) => !isEmailAttachmentSizeAllowed(attachment.content.byteLength))) {
    return { ok: false, message: "The PDF attachment is too large to email." };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: {
        user: "resend", // Literal string required by Resend
        pass: apiKey,   // Your re_... key
      },
    });

    await transporter.sendMail({
      from: fromAddress,
      ...message,
    });

    return { ok: true };
  } catch (error: any) {
    console.error("Resend SMTP Error:", error);
    return { 
      ok: false, 
      message: error?.message || "Email delivery failed. Please try again." 
    };
  }
}