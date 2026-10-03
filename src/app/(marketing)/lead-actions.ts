"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { storeMarketingLead } from "@/lib/marketing-lead-submission";
import { leadAttributionData, marketingAttributionCookie } from "@/lib/marketing-attribution";
import { parsePublicLead } from "@/lib/public-lead-validation";
import { publicLeadIp, validFormStarted, verifyLeadTurnstile } from "@/lib/public-lead-verification";
import { publicLeadAdmission, LeadAdmissionThresholdError } from "@/lib/public-lead-admission";
import { isBlockedLeadEmailDomain } from "@/lib/public-lead-blocked-domains";
import { logLeadProtection, type LeadProtectionEvent } from "@/lib/public-lead-observability";

async function createLead(source: MarketingLeadSource, formData: FormData, destination: LeadProtectionEvent["submissionPath"]) {
  // Match normal success even if a bot also filled retired/unknown fields.
  const event: LeadProtectionEvent = {
    source, submissionPath: destination,
    outcome: "rejected", stage: "honeypot", reason: "none", turnstile: null,
    formStartValid: null, honeypotTriggered: false, validationPassed: null,
    blockedDomainMatched: null, admission: null,
  };
  if (formData.getAll("website").some((value) => typeof value === "string" && value.trim())) {
    event.honeypotTriggered = true;
    event.reason = "honeypot_triggered";
    logLeadProtection(event);
    redirect(`${destination}?sent=1`);
  }
  let outcome = "sent=1";
  try {
    event.stage = "validation";
    event.reason = "invalid_input";
    event.validationPassed = false;
    const data = parsePublicLead(source, formData);
    event.validationPassed = true;
    event.stage = "form_start";
    event.reason = "invalid_form_start";
    event.formStartValid = validFormStarted(String(formData.get("formStarted") ?? ""), source);
    if (!event.formStartValid) {
      outcome = "error=verification";
    } else {
      event.stage = "turnstile";
      event.reason = "turnstile_failed";
      event.turnstile = await verifyLeadTurnstile(String(formData.get("cf-turnstile-response") ?? ""), source);
      if (!event.turnstile.valid) {
        outcome = "error=verification";
      } else {
        event.stage = "blocked_domain";
        event.blockedDomainMatched = isBlockedLeadEmailDomain(data.email);
        if (event.blockedDomainMatched) {
          // Match the honeypot/duplicate success redirect; do not identify the rule.
          event.reason = "blocked_domain";
        } else {
          event.stage = "client_address";
          event.reason = "unavailable";
          const ip = publicLeadIp(await headers());
          event.stage = "shop_lookup";
          event.reason = "shop_unavailable";
          const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
          if (shops.length !== 1) throw new Error("Shop unavailable");
          const shopId = shops[0].id;
          event.stage = "attribution";
          event.reason = "unavailable";
          const attribution = leadAttributionData((await cookies()).get(marketingAttributionCookie)?.value, destination);
          event.stage = "admission";
          event.reason = "unavailable";
          const admit = publicLeadAdmission(shopId, data, ip);
          const lead = await storeMarketingLead({ ...attribution, ...data, shopId }, async (transaction) => {
            const admitted = await admit(transaction);
            if (admitted) event.stage = "storage";
            return admitted;
          });
          if (lead) {
            event.outcome = "accepted";
            event.admission = "admitted";
            event.stage = "storage";
            event.reason = "none";
          } else {
            event.outcome = "duplicate";
            event.admission = "duplicate";
            event.reason = "duplicate";
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof LeadAdmissionThresholdError) {
      event.admission = `${error.threshold}_threshold`;
      event.reason = event.admission;
    }
    outcome = "error=1";
  }
  logLeadProtection(event);
  redirect(`${destination}?${outcome}`);
}

export async function submitContactLead(formData: FormData) { return createLead("CONTACT", formData, "/contact"); }
export async function submitAppointmentLead(formData: FormData) { return createLead("APPOINTMENT", formData, "/appointment"); }
export async function submitDropOffLead(formData: FormData) { return createLead("DROP_OFF", formData, "/drop-off"); }
