import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { MarketingLeadSource } from "@/generated/prisma/client";

export const MIN_FORM_COMPLETION_MS = 3000;

export function leadProtectionHash(value: string) {
  const secret = process.env.LEAD_ABUSE_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Lead protection is not configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createFormStarted(source: MarketingLeadSource, now = Date.now()) {
  try {
    const payload = `${source}.${now}.${randomUUID()}`;
    return `${payload}.${leadProtectionHash(`form:${payload}`)}`;
  } catch { return ""; }
}

export function validFormStarted(token: string, source: MarketingLeadSource, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== source || !/^\d{13}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false;
  const age = now - Number(parts[1]);
  if (age < MIN_FORM_COMPLETION_MS || age > 7 * 24 * 60 * 60 * 1000) return false;
  try {
    return timingSafeEqual(Buffer.from(parts[3]), Buffer.from(leadProtectionHash(`form:${parts.slice(0, 3).join(".")}`)));
  } catch { return false; }
}

export function publicLeadIp(headers: Pick<Headers, "get">) {
  // Only trust the platform-overwritten header on Vercel; never CF/custom headers.
  if (process.env.VERCEL !== "1") return "local-development";
  const ip = headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!isIP(ip)) throw new Error("Missing client address");
  return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;
}

export type LeadTurnstileReason = "none" | "missing_config" | "missing_token" | "invalid_token" | "http_error" | "timeout" | "unavailable" | "invalid_response" | "verification_failed" | "hostname_mismatch" | "action_mismatch";

export type LeadTurnstileResult = {
  valid: boolean; requestCompleted: boolean; success: boolean;
  hostnameMatched: boolean; actionMatched: boolean; reason: LeadTurnstileReason;
};

export async function verifyLeadTurnstile(token: string, source: MarketingLeadSource): Promise<LeadTurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hosts = process.env.TURNSTILE_ALLOWED_HOSTNAMES?.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const failed = (reason: LeadTurnstileReason, requestCompleted = false, success = false, hostnameMatched = false, actionMatched = false): LeadTurnstileResult =>
    ({ valid: false, requestCompleted, success, hostnameMatched, actionMatched, reason });
  if (!secret || !hosts?.length) return failed("missing_config");
  if (!token) return failed("missing_token");
  if (token.length > 2048 || /\s|[\u0000-\u001f\u007f]/u.test(token)) return failed("invalid_token");
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return failed("http_error", true);
    let result: unknown;
    try { result = await response.json(); }
    catch { return failed("invalid_response", true); }
    if (!result || typeof result !== "object") return failed("invalid_response", true);
    const value = result as { success?: unknown; hostname?: unknown; action?: unknown };
    const success = value.success === true;
    const hostnameMatched = typeof value.hostname === "string" && hosts.includes(value.hostname.toLowerCase());
    const actionMatched = value.action === source;
    if (!success) return failed("verification_failed", true, false, hostnameMatched, actionMatched);
    if (!hostnameMatched) return failed("hostname_mismatch", true, true, false, actionMatched);
    if (!actionMatched) return failed("action_mismatch", true, true, true, false);
    return { valid: true, requestCompleted: true, success: true, hostnameMatched: true, actionMatched: true, reason: "none" };
  } catch (error) {
    return failed(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "unavailable");
  }
}
