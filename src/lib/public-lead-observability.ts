import "server-only";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import type { LeadTurnstileResult } from "@/lib/public-lead-verification";

export type LeadProtectionStage = "honeypot" | "validation" | "form_start" | "turnstile" | "blocked_domain" | "client_address" | "shop_lookup" | "attribution" | "admission" | "storage";
export type LeadProtectionReason = "none" | "honeypot_triggered" | "invalid_input" | "invalid_form_start" | "turnstile_failed" | "blocked_domain" | "shop_unavailable" | "duplicate" | "ip_threshold" | "email_threshold" | "phone_threshold" | "unavailable";
export type LeadProtectionAdmission = "admitted" | "duplicate" | "ip_threshold" | "email_threshold" | "phone_threshold" | null;

export type LeadProtectionEvent = {
  source: MarketingLeadSource;
  submissionPath: "/contact" | "/appointment" | "/drop-off";
  outcome: "accepted" | "rejected" | "duplicate";
  stage: LeadProtectionStage;
  reason: LeadProtectionReason;
  turnstile: LeadTurnstileResult | null;
  formStartValid: boolean | null;
  honeypotTriggered: boolean;
  validationPassed: boolean | null;
  blockedDomainMatched: boolean | null;
  admission: LeadProtectionAdmission;
};

export function logLeadProtection(event: LeadProtectionEvent) {
  // Construct an allowlisted payload. Never pass the form, headers, or exceptions.
  console.info("public_lead_protection", {
    source: event.source, submissionPath: event.submissionPath,
    outcome: event.outcome, stage: event.stage, reason: event.reason,
    turnstile: event.turnstile && {
      valid: event.turnstile.valid, requestCompleted: event.turnstile.requestCompleted,
      success: event.turnstile.success, hostnameMatched: event.turnstile.hostnameMatched,
      actionMatched: event.turnstile.actionMatched, reason: event.turnstile.reason,
    },
    formStartValid: event.formStartValid, honeypotTriggered: event.honeypotTriggered,
    validationPassed: event.validationPassed, blockedDomainMatched: event.blockedDomainMatched,
    admission: event.admission,
  });
}
