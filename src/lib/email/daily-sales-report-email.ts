import type { DailySalesReportModel } from "../data/reports";
import {
  canEmailDailySalesReport,
  dailySalesReportFilename,
  dailySalesReportTitle,
  formatReportDateRange,
  formatReportGeneratedAt,
  isValidReportRange,
  normalizeDailySalesReportOutput,
  type DailySalesReportOutput,
} from "../daily-sales-report-model.ts";
import type { ResendSendResult } from "./resend";

export const MAX_DAILY_SALES_PDF_BASE64_BYTES = 35 * 1024 * 1024;
type ResendErrorCode = Extract<ResendSendResult, { ok: false }>["code"];

export type DailySalesEmailResult =
  | { ok: true }
  | { ok: false; code: "pdf_render_failed" | "attachment_too_large" | ResendErrorCode; message: string };

export type DailySalesEmailRequestValidation =
  | { ok: true; recipient: string; from: string; to: string; output: DailySalesReportOutput }
  | { ok: false; message: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateDailySalesEmailRequest(input: {
  authenticated: boolean;
  hasMembership: boolean;
  role?: string | null;
  recipient: string;
  from: string;
  to: string;
  output?: string | null;
}): DailySalesEmailRequestValidation {
  if (!input.authenticated || !input.hasMembership) {
    return { ok: false, message: "You must be signed in with an active shop membership." };
  }
  if (!canEmailDailySalesReport(input.role)) {
    return { ok: false, message: "Only an owner or administrator can email reports." };
  }
  const recipient = input.recipient.trim().toLowerCase();
  if (!recipient || recipient.length > 254 || !emailPattern.test(recipient)) {
    return { ok: false, message: "Enter a valid recipient email address." };
  }
  if (!isValidReportRange(input.from, input.to)) {
    return { ok: false, message: "Choose a valid report date range." };
  }
  return { ok: true, recipient, from: input.from, to: input.to, output: normalizeDailySalesReportOutput(input.output) };
}

export function isDailySalesPdfEncodedSizeAllowed(encodedBytes: number) {
  return encodedBytes <= MAX_DAILY_SALES_PDF_BASE64_BYTES;
}

export async function deliverDailySalesReportEmail(
  report: DailySalesReportModel,
  recipient: string,
  output: DailySalesReportOutput,
  dependencies: {
    renderPdf: (report: DailySalesReportModel, output: DailySalesReportOutput) => Promise<Buffer>;
    sendEmail: (message: { to: string; subject: string; text: string; html: string; attachments: Array<{ filename: string; content: string }> }) => Promise<ResendSendResult>;
  },
): Promise<DailySalesEmailResult> {
  let pdf: Buffer;
  try {
    pdf = await dependencies.renderPdf(report, output);
  } catch {
    return { ok: false, code: "pdf_render_failed", message: "The report PDF could not be generated." };
  }
  const content = pdf.toString("base64");
  if (!isDailySalesPdfEncodedSizeAllowed(Buffer.byteLength(content, "utf8"))) {
    return { ok: false, code: "attachment_too_large", message: "This complete report is too large to email. Use Print Report and save it as a PDF instead." };
  }

  const range = formatReportDateRange(report.from, report.to);
  const title = dailySalesReportTitle(output);
  const filename = dailySalesReportFilename(report.from, report.to, output);
  const result = await dependencies.sendEmail({
    to: recipient,
    subject: `${report.shop.name} ${title} — ${range}`,
    text: `The ${title} for ${range} is attached.`,
    html: `<p><strong>${escapeHtml(report.shop.name)}</strong></p><p>The ${title} for ${escapeHtml(range)} is attached.</p><p>${escapeHtml(formatReportGeneratedAt(report.generatedAt))}</p>`,
    attachments: [{ filename, content }],
  });
  return result.ok ? { ok: true } : result;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
