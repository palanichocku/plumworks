"use server";

import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/data/membership";
import { submitConsent, verifyConsentPin } from "@/lib/messaging/sms-consent";

export async function verifySmsConsentPinAction(token: string, pin: string) {
  try { return await verifyConsentPin(token, pin); }
  catch { return false; }
}

export async function submitSmsConsent(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const customerName = String(formData.get("customerName") ?? "");
  const checked = formData.get("decision") === "agree";
  // The submit button alone does not prove opt-in; require the separate, affirmative checkbox.
  if (checked && formData.get("consentConfirmed") !== "yes")
    redirect(`/sms-consent/${encodeURIComponent(token)}?error=invalid`);
  if (formData.get("decision") !== "agree" && formData.get("decision") !== "decline")
    redirect(`/sms-consent/${encodeURIComponent(token)}?error=invalid`);
  const { user, membership } = await getCurrentMembership();
  const staff = user && membership ? { userId: user.id, shopId: membership.shopId } : undefined;
  const result = await submitConsent({ token, pin, customerName, checked, staff })
    .catch(() => ({ ok: false as const, reason: "invalid" as const }));
  if (!result.ok) redirect(`/sms-consent/${encodeURIComponent(token)}?error=invalid`);
  redirect(`/sms-consent/completed?consented=${result.consented ? "yes" : "no"}`);
}
