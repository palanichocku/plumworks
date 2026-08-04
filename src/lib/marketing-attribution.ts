export const marketingAttributionCookie = "plumworks_marketing_first_touch";
export const marketingAttributionVersion = 1;

export const attributionLimits = {
  source: 100,
  medium: 100,
  campaign: 200,
  term: 300,
  content: 300,
  clickId: 300,
  referrer: 500,
  path: 500,
} as const;

export type MarketingAttribution = {
  version: typeof marketingAttributionVersion;
  source: string;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  googleClickId: string | null;
  facebookClickId: string | null;
  microsoftClickId: string | null;
  referrer: string | null;
  landingPath: string;
  firstTouchAt: string;
};

type LeadAttributionRecord = {
  source: string;
  attributionSource?: string | null;
  attributionMedium?: string | null;
  attributionCampaign?: string | null;
  firstTouchAt?: Date | null;
};

function clean(value: string | null | undefined, maximum: number): string | null {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximum);
  return normalized || null;
}

export function normalizeAttributionPath(value: string | null | undefined): string | null {
  const path = clean(value, attributionLimits.path);
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const url = new URL(path, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return null;
    return clean(url.pathname, attributionLimits.path);
  } catch { return null; }
}

export function normalizeAttributionReferrer(value: string | null | undefined, currentOrigin?: string): string | null {
  const referrer = clean(value, attributionLimits.referrer);
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || (currentOrigin && url.origin === currentOrigin)) return null;
    return clean(`${url.origin}${url.pathname}`, attributionLimits.referrer);
  } catch { return null; }
}

function inferredSource(parameters: URLSearchParams, referrer: string | null) {
  return clean(parameters.get("utm_source"), attributionLimits.source)
    || (parameters.has("gclid") ? "google" : null)
    || (parameters.has("fbclid") ? "facebook" : null)
    || (parameters.has("msclkid") ? "microsoft" : null)
    || (referrer ? "referral" : "direct");
}

export function captureFirstTouch(input: { searchParams: URLSearchParams; pathname: string; origin: string; referrer?: string | null; now?: Date }): MarketingAttribution {
  const referrer = normalizeAttributionReferrer(input.referrer, input.origin);
  const source = inferredSource(input.searchParams, referrer)!;
  const clickAttributed = input.searchParams.has("gclid") || input.searchParams.has("fbclid") || input.searchParams.has("msclkid");
  return {
    version: marketingAttributionVersion,
    source,
    medium: clean(input.searchParams.get("utm_medium"), attributionLimits.medium) || (clickAttributed && source !== "direct" && source !== "referral" ? "paid" : referrer && source === "referral" ? "referral" : null),
    campaign: clean(input.searchParams.get("utm_campaign"), attributionLimits.campaign),
    term: clean(input.searchParams.get("utm_term"), attributionLimits.term),
    content: clean(input.searchParams.get("utm_content"), attributionLimits.content),
    googleClickId: clean(input.searchParams.get("gclid"), attributionLimits.clickId),
    facebookClickId: clean(input.searchParams.get("fbclid"), attributionLimits.clickId),
    microsoftClickId: clean(input.searchParams.get("msclkid"), attributionLimits.clickId),
    referrer,
    landingPath: normalizeAttributionPath(input.pathname) || "/",
    firstTouchAt: (input.now || new Date()).toISOString(),
  };
}

export function preserveFirstTouch(existing: string | null | undefined, input: Parameters<typeof captureFirstTouch>[0]): MarketingAttribution {
  return parseFirstTouch(existing) || captureFirstTouch(input);
}

export function parseFirstTouch(value: string | null | undefined): MarketingAttribution | null {
  if (!value || value.length > 4000) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MarketingAttribution>;
    if (parsed.version !== marketingAttributionVersion) return null;
    const firstTouch = new Date(String(parsed.firstTouchAt || ""));
    const landingPath = normalizeAttributionPath(parsed.landingPath);
    const source = clean(parsed.source, attributionLimits.source);
    if (!source || !landingPath || Number.isNaN(firstTouch.getTime())) return null;
    return {
      version: marketingAttributionVersion,
      source,
      medium: clean(parsed.medium, attributionLimits.medium),
      campaign: clean(parsed.campaign, attributionLimits.campaign),
      term: clean(parsed.term, attributionLimits.term),
      content: clean(parsed.content, attributionLimits.content),
      googleClickId: clean(parsed.googleClickId, attributionLimits.clickId),
      facebookClickId: clean(parsed.facebookClickId, attributionLimits.clickId),
      microsoftClickId: clean(parsed.microsoftClickId, attributionLimits.clickId),
      referrer: normalizeAttributionReferrer(parsed.referrer),
      landingPath,
      firstTouchAt: firstTouch.toISOString(),
    };
  } catch { return null; }
}

export function leadAttributionData(firstTouchValue: string | null | undefined, submissionPath: string, now = new Date()) {
  const firstTouch = parseFirstTouch(firstTouchValue) || captureFirstTouch({ searchParams: new URLSearchParams(), pathname: submissionPath, origin: "https://local.invalid", now });
  return {
    attributionSource: firstTouch.source,
    attributionMedium: firstTouch.medium,
    attributionCampaign: firstTouch.campaign,
    attributionTerm: firstTouch.term,
    attributionContent: firstTouch.content,
    googleClickId: firstTouch.googleClickId,
    facebookClickId: firstTouch.facebookClickId,
    microsoftClickId: firstTouch.microsoftClickId,
    referrer: firstTouch.referrer,
    landingPath: firstTouch.landingPath,
    submissionPath: normalizeAttributionPath(submissionPath) || "/",
    firstTouchAt: new Date(firstTouch.firstTouchAt),
  };
}

export function normalizedLeadAttributionSummary(lead: LeadAttributionRecord) {
  return {
    source: lead.attributionSource || "unknown",
    medium: lead.attributionMedium || null,
    campaign: lead.attributionCampaign || null,
    formType: lead.source.toLowerCase().replace("_", "-"),
    firstTouchAt: lead.firstTouchAt || null,
  };
}
