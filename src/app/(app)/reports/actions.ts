"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { getDailySalesReportModel } from "@/lib/data/reports";
import { deliverDailySalesReportEmail, validateDailySalesEmailRequest } from "@/lib/email/daily-sales-report-email";
import { sendResendEmail } from "@/lib/email/resend";
import { renderDailySalesReportPdf } from "@/lib/reports/render-daily-sales-report-pdf";

export type EmailDailySalesReportState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function emailDailySalesReport(
  _previous: EmailDailySalesReportState,
  formData: FormData,
): Promise<EmailDailySalesReportState> {
  const { user, membership } = await getCurrentMembership();
  const validation = validateDailySalesEmailRequest({
    authenticated: Boolean(user),
    hasMembership: Boolean(membership),
    role: membership?.role,
    recipient: String(formData.get("recipient") ?? ""),
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? ""),
    output: String(formData.get("output") ?? ""),
  });
  if (!validation.ok) return failure(validation.message);
  if (!membership) return failure("You must be signed in with an active shop membership.");
  const { recipient, from, to, output } = validation;

  let report;
  try {
    // Reload every value from the authenticated shop. Browser-supplied totals,
    // rows, shop identity, and PDF content are intentionally not accepted.
    report = await getDailySalesReportModel({ from, to });
  } catch {
    return failure("The report could not be loaded. No email was sent.");
  }
  if (!report || report.shop.id !== membership.shopId) return failure("The report could not be loaded for this shop.");

  const result = await deliverDailySalesReportEmail(report, recipient, output, {
    renderPdf: renderDailySalesReportPdf,
    sendEmail: sendResendEmail,
  });
  return result.ok
    ? { status: "success", message: `Daily Sales Report emailed to ${recipient}.` }
    : failure(result.message);
}

function failure(message: string): EmailDailySalesReportState {
  return { status: "error", message };
}
