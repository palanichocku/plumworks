import "server-only";

import type { MarketingLead } from "@/generated/prisma/client";

const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;

function value(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "Not provided" : String(value);
}

async function sendEmail(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!apiKey || !from) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
  } catch {
    return;
  }
}

export async function notifyNewMarketingLead(lead: MarketingLead) {
  const to = process.env.MARKETING_LEADS_NOTIFY_EMAIL?.trim();
  if (!to) return;

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
    `Preferred time: ${value(lead.preferredTime)}`,
    `Message: ${value(lead.message)}`,
    "",
    adminUrl ? `Check Admin → Leads: ${adminUrl}` : "Check Admin → Leads in PlumWorks.",
  ].join("\n");

  await sendEmail(to, `New ${sourceLabels[lead.source]} lead`, text);
}

export async function notifyScheduledMarketingLead(lead: MarketingLead) {
  if (!lead.email || !lead.scheduledDate || !lead.scheduledTime) return;
  const date = lead.scheduledDate.toISOString().slice(0, 10);
  const text = [
    `Hello ${lead.name},`,
    "",
    `Your appointment has been scheduled for ${date} at ${lead.scheduledTime}.`,
    `Requested service: ${value(lead.requestedService)}`,
    "",
    "Please contact the shop if you need to change this time.",
  ].join("\n");
  await sendEmail(lead.email, "Your repair appointment is scheduled", text);
}
