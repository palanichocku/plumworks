import type { MarketingLeadSource } from "@/generated/prisma/client";
import { normalizedNorthAmericanPhoneDigits } from "@/lib/customer-phone";
import { parseLeadContactMethod } from "@/lib/marketing-lead-contact";
import { requestedServices } from "@/lib/marketing-requested-services";

export function normalizeLeadText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const commonFields = ["name", "phone", "email", "preferredContactMethod", "requestedService", "website", "formStarted", "cf-turnstile-response"];

// Reject unknown fields (including every former message/concern/notes field),
// repeated parameters, files, controls, and oversized bodies instead of truncating.
export function validateLeadEnvelope(source: MarketingLeadSource, form: FormData) {
  const allowed = new Set([...commonFields, ...(source === "CONTACT" ? [] : ["vehicleYear", "vehicleMake", "vehicleModel", "preferredDate"]), ...(source === "APPOINTMENT" ? ["preferredTime"] : [])]);
  const seen = new Set<string>();
  let bytes = 0;
  let fields = 0;
  for (const [key, value] of form.entries()) {
    if (++fields > 30 || typeof value !== "string") throw new Error("Invalid form");
    bytes += new TextEncoder().encode(key + value).length;
    if (bytes > 8192 || key.length > 100 || value.length > 2048) throw new Error("Invalid form");
    // React adds its own action metadata to progressively enhanced forms.
    if (key.startsWith("$ACTION_")) continue;
    if (!allowed.has(key) || seen.has(key)) throw new Error("Invalid form");
    seen.add(key);
  }
}

export function parsePublicLead(source: MarketingLeadSource, form: FormData, now = new Date()) {
  validateLeadEnvelope(source, form);
  function field(key: string, max: number, required = true) {
    const raw = form.get(key) ?? "";
    if (typeof raw !== "string" || raw.length > max || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("Invalid field");
    const value = normalizeLeadText(raw);
    if (required && !value) throw new Error("Missing field");
    return value;
  }
  const name = field("name", 120);
  const phone = normalizedNorthAmericanPhoneDigits(field("phone", 40));
  const email = field("email", 200).toLowerCase();
  const preferredContactMethod = parseLeadContactMethod(field("preferredContactMethod", 20));
  const service = requestedServices.find(({ value }) => value === field("requestedService", 40));
  if (!phone || phone.length !== 10 || !/^[^\s@<>(),;:\\"]+@[^\s@<>(),;:\\"]+\.[^\s@<>(),;:\\"]+$/.test(email) || !preferredContactMethod || !service) throw new Error("Invalid contact or service");
  let vehicleYear: number | null = null;
  let vehicleMake: string | null = null;
  let vehicleModel: string | null = null;
  let preferredDate: Date | null = null;
  let preferredTime: string | null = null;
  if (source !== "CONTACT") {
    const year = field("vehicleYear", 4);
    vehicleYear = Number(year);
    if (!/^\d{4}$/.test(year) || vehicleYear < 1900 || vehicleYear > now.getUTCFullYear() + 2) throw new Error("Invalid year");
    vehicleMake = field("vehicleMake", 80);
    vehicleModel = field("vehicleModel", 80);
    const date = field("preferredDate", 10);
    preferredDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(preferredDate.getTime()) || preferredDate.toISOString().slice(0, 10) !== date || date < `${now.getUTCFullYear() - 1}-01-01` || date > `${now.getUTCFullYear() + 2}-12-31`) throw new Error("Invalid date");
    if (source === "APPOINTMENT") {
      preferredTime = field("preferredTime", 5, false) || null;
      if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) throw new Error("Invalid time");
    }
  }
  // Store the canonical human-readable label so existing lead views/email work unchanged.
  return { source, name, phone, email, preferredContactMethod, requestedService: service.label, vehicleYear, vehicleMake, vehicleModel, preferredDate, preferredTime, message: null };
}

export type PublicLeadData = ReturnType<typeof parsePublicLead>;
