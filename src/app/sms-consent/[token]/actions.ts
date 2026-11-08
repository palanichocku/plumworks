"use server";
import { redirect } from "next/navigation";
import { submitConsent } from "@/lib/messaging/sms-consent";

export async function submitSmsConsent(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const phoneInput = String(formData.get("phoneInput") ?? "");
  const customerName = String(formData.get("customerName") ?? "");
  const checked = formData.get("smsOptIn") === "yes";
  const result = await submitConsent({ token, pin, phoneInput, customerName, checked }).catch(() => ({ ok: false as const, reason: "invalid" as const }));
  if (!result.ok) redirect(`/sms-consent/${encodeURIComponent(token)}?error=invalid`);
  redirect(`/sms-consent/completed?consented=${result.consented ? "yes" : "no"}`);
}
