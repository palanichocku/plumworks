"use server";

import nodemailer from "nodemailer";
import { renderToBuffer } from "@react-pdf/renderer";
import { DailySalesReportPDF } from "@/components/pdf/daily-sales-report-pdf";
import { getDailySalesReportModel } from "@/lib/data/reports";

export async function sendDailySalesReportEmail(
  emailAddress: string,
  from: string,
  to: string
) {
  try {
    console.log(`[Email Action] Starting generation for ${from} to ${to}...`);

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error("[Email Action] Missing SMTP environment variables.");
      return { success: false, error: "Server email configuration is missing." };
    }

    const report = await getDailySalesReportModel({ from, to });
    if (!report) {
      return { success: false, error: "Could not retrieve report data." };
    }

    console.log("[Email Action] Generating PDF buffer...");
    // If your terminal hangs right after this log, @react-pdf is failing to compile 
    // the layout in the server environment.
    const pdfBuffer = await renderToBuffer(
      <DailySalesReportPDF report={report} fromDate={from} toDate={to} />
    );

    console.log("[Email Action] Connecting to SMTP...");
    const transporter = nodemailer.createTransport({
      service: "gmail", 
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    // Verify connection configuration
    await transporter.verify();

    console.log("[Email Action] Sending email...");
    const info = await transporter.sendMail({
      from: `"CAR DOC LLC Reports" <${process.env.EMAIL_USER}>`,
      to: emailAddress,
      subject: `Daily Sales Report: ${from} to ${to}`,
      text: `Please find the requested daily sales report for CAR DOC LLC attached as a PDF.\n\nInvoice Range: ${from} to ${to}`,
      attachments: [
        {
          filename: `CAR_DOC_Daily_Sales_${from}_to_${to}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    console.log("[Email Action] Email sent successfully:", info.messageId);
    return { success: true };
  } catch (error: any) {
    console.error("[Email Action] Fatal error:", error);
    // Return the actual error message to the toast notification for easier debugging
    return { success: false, error: error.message || "Failed to send the report email." };
  }
}