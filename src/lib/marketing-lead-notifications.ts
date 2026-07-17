import "server-only";

import type { MarketingLead } from "@/generated/prisma/client";

const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;

function value(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "Not provided" : String(value);
}

export async function notifyNewMarketingLead(lead: MarketingLead) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.MARKETING_LEADS_NOTIFY_EMAIL?.trim();
  const from = process.env.TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!apiKey || !to || !from) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const adminUrl = siteUrl ? `${siteUrl}/admin/leads` : null;
  const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ") || "Not provided";
  const text = [
    `New ${sourceLabels[lead.source]} lead`,
    "",
    `Name: ${lead.name}`,
    `Phone: ${value(lead.phone)}`,
    `Email: ${value(lead.email)}`,
    `Vehicle: ${vehicle}`,
    `Requested service: ${value(lead.requestedService)}`,
    `Preferred date: ${lead.preferredDate ? lead.preferredDate.toISOString().slice(0, 10) : "Not provided"}`,
    `Message: ${value(lead.message)}`,
    "",
    adminUrl ? `Check Admin → Leads: ${adminUrl}` : "Check Admin → Leads in PlumWorks.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `New ${sourceLabels[lead.source]} lead`, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
  } catch {
    return;
  }
}
