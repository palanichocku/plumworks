import type { Metadata } from "next";
import type { PublicShop } from "@/lib/marketing";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingBrandName } from "@/lib/marketing-content";

export type PublicSeoShop = PublicShop & { legalName: string | null };

export function publicSeoShop(shop: PublicShop, brandName: string | null): PublicSeoShop {
  const publicName = brandName?.trim() || shop.name;
  return { ...shop, name: publicName, legalName: publicName === shop.name ? null : shop.name };
}

export async function getPublicSeoShop(): Promise<PublicSeoShop> {
  const [shop, brandName] = await Promise.all([getPublicShop(), getMarketingBrandName()]);
  return publicSeoShop(shop, brandName);
}

const FORBIDDEN_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "www.subbuscardoc.com", "subbuscardoc.com"]);

export function configuredPublicSiteOrigin(environment: NodeJS.ProcessEnv = process.env): URL | null {
  const configured = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || FORBIDDEN_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (/--[a-z0-9-]+\.vercel\.app$/i.test(url.hostname) || /-git-[a-z0-9-]+\.vercel\.app$/i.test(url.hostname)) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

export function marketingIndexingEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV === "production" && environment.VERCEL_ENV !== "preview" && configuredPublicSiteOrigin(environment) !== null;
}

export function canonicalUrl(path: string, environment: NodeJS.ProcessEnv = process.env) {
  const origin = configuredPublicSiteOrigin(environment);
  if (!origin) return null;
  const canonical = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  canonical.search = "";
  canonical.hash = "";
  return canonical;
}

export function marketingMetadata({ title, description, path, siteName, index = true }: { title: string; description: string; path: string; siteName: string; index?: boolean }): Metadata {
  const canonical = canonicalUrl(path);
  const allowIndex = index && marketingIndexingEnabled();
  return {
    title: { absolute: title },
    description,
    ...(canonical ? { alternates: { canonical }, openGraph: { type: "website", title, description, url: canonical, siteName }, twitter: { card: "summary", title, description } } : {}),
    robots: { index: allowIndex, follow: allowIndex },
  };
}

export function localTitle(subject: string, shop: PublicShop) {
  const locality = [shop.city, shop.state].filter(Boolean).join(", ");
  return [subject, locality ? `in ${locality}` : null, shop.name ? `| ${shop.name}` : null].filter(Boolean).join(" ");
}

export function serviceSeoTitle(slug: string, serviceName: string) {
  const titles: Record<string, string> = {
    diagnostics: "Check Engine Light & Diagnostics",
    "oil-change": "Oil Change",
    brakes: "Brake Repair",
    "scheduled-maintenance": "Auto Maintenance",
    "ac-heating-cooling": "Auto A/C, Heating & Cooling Repair",
    "battery-electrical": "Battery, Starting & Electrical Repair",
    "steering-suspension": "Steering & Suspension Repair",
    "transmission-clutch": "Transmission & Clutch Service",
    "engine-repair": "Engine Repair",
    "undercar-service": "Undercar Inspection & Service",
  };
  return titles[slug] ?? serviceName;
}

export function openingHoursSpecifications(hours: string) {
  const dayNames: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
  const result: Array<Record<string, unknown>> = [];
  for (const line of hours.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z]+)(?:\s*[-–]\s*([A-Za-z]+))?:\s*(.+)$/);
    if (!match || /closed/i.test(match[3])) continue;
    const time = match[3].match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*[-–]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)$/i);
    if (!time) continue;
    const start = dayNames[match[1].toLowerCase()]; const end = dayNames[(match[2] ?? match[1]).toLowerCase()];
    if (!start || !end) continue;
    const days = Object.values(dayNames); const range = days.slice(days.indexOf(start), days.indexOf(end) + 1);
    const clock = (hour: string, minute: string | undefined, period: string) => `${String((Number(hour) % 12) + (/pm/i.test(period) ? 12 : 0)).padStart(2, "0")}:${minute ?? "00"}`;
    result.push({ "@type": "OpeningHoursSpecification", dayOfWeek: range, opens: clock(time[1], time[2], time[3]), closes: clock(time[4], time[5], time[6]) });
  }
  return result;
}

export function autoRepairJsonLd(shop: PublicSeoShop) {
  const origin = configuredPublicSiteOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "@id": origin ? `${origin.origin}/#business` : undefined,
    name: shop.name,
    legalName: shop.legalName ?? undefined,
    url: origin?.origin,
    telephone: shop.phone ?? undefined,
    address: shop.addressLine1 || shop.city || shop.state || shop.postalCode ? { "@type": "PostalAddress", streetAddress: shop.addressLine1 ?? undefined, addressLocality: shop.city ?? undefined, addressRegion: shop.state ?? undefined, postalCode: shop.postalCode ?? undefined, addressCountry: "US" } : undefined,
    openingHoursSpecification: openingHoursSpecifications(shop.hours),
  };
}

export function safeJsonLd(value: unknown) { return JSON.stringify(value).replaceAll("<", "\\u003c"); }
