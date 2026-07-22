"use server";

import nodemailer from "nodemailer";

export async function sendReportEmail(recipientEmail: string, reportData: string) {
  try {
    // 1. Configure the SMTP transporter using Gmail
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // 2. Define the email options
    const mailOptions = {
      from: `"Car Doc Reports" <${process.env.GMAIL_USER}>`,
      to: recipientEmail,
      subject: "Your Requested Shop Report",
      // You can send plain text or HTML here
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #0f172a;">Shop Activity Report</h2>
          <p>Here is the requested report data:</p>
          <pre style="background: #f8fafc; padding: 15px; border-radius: 8px;">
            ${reportData}
          </pre>
        </div>
      `,
    };

    // 3. Send the email
    const info = await transporter.sendMail(mailOptions);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Failed to send email:", error);
    return { success: false, error: "Failed to send report" };
  }
}