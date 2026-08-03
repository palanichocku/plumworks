import "server-only";

import nodemailer from "nodemailer";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  isEmailAttachmentSizeAllowed,
  sendResendSmtpMessage,
  type SmtpEmailMessage,
  type SmtpEmailSendResult,
} from "@/lib/email/smtp-core";

export { MAX_EMAIL_ATTACHMENT_BYTES, isEmailAttachmentSizeAllowed };
export type EmailMessage = SmtpEmailMessage;
export type EmailSendResult = SmtpEmailSendResult;

export async function sendGmailMessage(message: EmailMessage): Promise<EmailSendResult> {
  const transporter = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: {
        user: "resend", // Literal string required by Resend
        pass: process.env.RESEND_API_KEY?.trim(),
      },
    });
  return sendResendSmtpMessage(message, {
    apiKey: process.env.RESEND_API_KEY,
    fromAddress: process.env.EMAIL_FROM,
    sendMail: (mail) => transporter.sendMail(mail),
    logError: (diagnostic) => console.error(diagnostic),
  });
}
