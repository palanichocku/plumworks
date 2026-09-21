import "server-only";

import type { MarketingLead } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { leadNotificationRecipients } from "@/lib/marketing-lead-notification-settings";
import { sendResendEmail } from "@/lib/email/resend";

const sourceLabels = { CONTACT: "Contact", APPOINTMENT: "Appointment", DROP_OFF: "Drop-Off" } as const;

function value(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "Not provided" : String(value);
}

async function sendEmail(to: string, subject: string, text: string) {
  await sendResendEmail({ to, subject, text });
}

export async function notifyNewMarketingLead(lead: MarketingLead) {
  const settings = await prisma.shop.findUniqueOrThrow({
    where: { id: lead.shopId },
    select: { marketingLeadEmailNotificationsEnabled: true, marketingLeadNotifyEmail1: true, marketingLeadNotifyEmail2: true },
  });
  const recipients = leadNotificationRecipients(settings, process.env.MARKETING_LEADS_NOTIFY_EMAIL);
  if (!recipients.length) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const leadsUrl = siteUrl ? `${siteUrl}/leads` : null;
  const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(" ") || "Not provided";
  const text = [
    `New ${sourceLabels[lead.source]} Request`,
    `Submission source: ${sourceLabels[lead.source]}`,
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
    leadsUrl ? `View Leads in PlumWorks: ${leadsUrl}` : "View Leads in PlumWorks.",
  ].join("\n");

  await Promise.all(recipients.map(async (to) => {
    try {
      const result = await sendResendEmail({ to, subject: `New ${sourceLabels[lead.source]} Request — ${lead.name.replace(/[\r\n]/g, " ")}`, text });
      if (!result.ok) console.error("Marketing lead email delivery failed", result.code);
    } catch {
      console.error("Marketing lead email delivery failed");
    }
  }));
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
