"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import { DailySalesReportPDF } from "@/components/pdf/daily-sales-report-pdf";
import { getDailySalesReportModel } from "@/lib/data/reports";
import { sendGmailMessage } from "@/lib/email/gmail";

export async function sendDailySalesReportEmail(
  emailAddress: string,
  from: string,
  to: string
) {
  try {
    console.log(`[Email Action] Starting generation for ${from} to ${to}...`);

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

    const result = await sendGmailMessage({
      to: emailAddress,
      subject: `Daily Sales Report: ${from} to ${to}`,
      text: `Please find the requested daily sales report for CAR DOC LLC attached as a PDF.\n\nInvoice Range: ${from} to ${to}`,
      attachments: [
        {
          filename: `CAR_DOC_Daily_Sales_${from}_to_${to}.pdf`,
          content: Buffer.from(pdfBuffer),
          contentType: "application/pdf",
        },
      ],
    });

    return result.ok ? { success: true } : { success: false, error: result.message };
  } catch {
    return { success: false, error: "Failed to send the report email." };
  }
}
