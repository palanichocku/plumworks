import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { MarketingLeadSource } from "@/generated/prisma/client";

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
  if (age < 500 || age > 7 * 24 * 60 * 60 * 1000) return false;
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

export async function verifyLeadTurnstile(token: string, source: MarketingLeadSource) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hosts = process.env.TURNSTILE_ALLOWED_HOSTNAMES?.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!secret || !hosts?.length || !token || token.length > 2048) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.success === true && typeof result.hostname === "string" && hosts.includes(result.hostname.toLowerCase()) && result.action === source;
  } catch { return false; }
}
