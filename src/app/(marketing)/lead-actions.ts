"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { storeMarketingLead } from "@/lib/marketing-lead-submission";
import { leadAttributionData, marketingAttributionCookie } from "@/lib/marketing-attribution";
import { parsePublicLead } from "@/lib/public-lead-validation";
import { publicLeadIp, validFormStarted, verifyLeadTurnstile } from "@/lib/public-lead-verification";
import { publicLeadAdmission } from "@/lib/public-lead-admission";

async function createLead(source: MarketingLeadSource, formData: FormData, destination: string) {
  // Match normal success even if a bot also filled retired/unknown fields.
  if (formData.getAll("website").some((value) => typeof value === "string" && value.trim())) redirect(`${destination}?sent=1`);
  let outcome = "sent=1";
  try {
    const data = parsePublicLead(source, formData);
    if (!validFormStarted(String(formData.get("formStarted") ?? ""), source)
      || !await verifyLeadTurnstile(String(formData.get("cf-turnstile-response") ?? ""), source)) {
      outcome = "error=verification";
    } else {
      const ip = publicLeadIp(await headers());
      const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
      if (shops.length !== 1) throw new Error("Shop unavailable");
      const shopId = shops[0].id;
      const attribution = leadAttributionData((await cookies()).get(marketingAttributionCookie)?.value, destination);
      await storeMarketingLead({ ...attribution, ...data, shopId }, publicLeadAdmission(shopId, data, ip));
    }
  } catch {
    outcome = "error=1";
  }
  redirect(`${destination}?${outcome}`);
}

export async function submitContactLead(formData: FormData) { return createLead("CONTACT", formData, "/contact"); }
export async function submitAppointmentLead(formData: FormData) { return createLead("APPOINTMENT", formData, "/appointment"); }
export async function submitDropOffLead(formData: FormData) { return createLead("DROP_OFF", formData, "/drop-off"); }
