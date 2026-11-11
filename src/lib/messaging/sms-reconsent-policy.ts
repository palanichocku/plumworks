/**
 * A verified Twilio START may reinstate an earlier service-message consent,
 * but cannot reverse a later explicit decline or authorize a different phone.
 * Source timestamps and disclosure version must belong to this shop/customer/phone.
 */
export type SmsRestorationEvidence = {
  latestDecision: "OPT_IN" | "OPT_OUT" | "DECLINED" | null;
  suppressed: boolean;
  consentAt: Date | null;
  consentVersion: string | null;
  declinedAt: Date | null;
  stoppedAt: Date | null;
  verifiedStartAt: Date | null;
};

export function canRestoreSmsConsent(evidence: SmsRestorationEvidence, currentVersion: string): boolean {
  if (evidence.suppressed || evidence.latestDecision !== "OPT_OUT" ||
      !evidence.consentAt || !evidence.stoppedAt || !evidence.verifiedStartAt ||
      evidence.consentVersion !== currentVersion) return false;
  const consent = evidence.consentAt.getTime();
  const stop = evidence.stoppedAt.getTime();
  const start = evidence.verifiedStartAt.getTime();
  if (![consent, stop, start].every(Number.isFinite) || !(consent < stop && stop < start)) return false;
  return !evidence.declinedAt || evidence.declinedAt.getTime() < consent;
}
