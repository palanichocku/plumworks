import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getPublicShop } from "@/lib/marketing";
import { marketingServices } from "@/lib/marketing-services";
import { marketingContentTablesAvailable } from "@/lib/marketing-schema";

export const fallbackMarketingSettings = {
  headline: "Auto repair built around trust.",
  subheadline: "Bring us the warning light, strange sound, maintenance question, or repair concern. We’ll listen, inspect, and help you understand the next step.",
  serviceIntro: "Start with the concern you notice or the maintenance you know is due. The shop will help confirm the right next step.",
  aboutTitle: "Built around the relationship",
  aboutBody: "Repair decisions are easier when the conversation is clear. A local shop can understand the concern, inspect thoughtfully, and help drivers choose a practical path forward.",
  contactIntro: "Call for the quickest conversation, or send a note and the shop can follow up.",
  reviewUrl: null as string | null,
};

export const fallbackPages = {
  coupons: { eyebrow: "Offers", title: "Helpful savings for planned care", description: "Ask the shop about current offers and eligibility.", body: null },
  reviews: { eyebrow: "Reviews", title: "Feedback helps local shops grow", description: "Verified customer feedback can help drivers know what to expect.", body: null },
  about: { eyebrow: "About", title: "A local approach to vehicle care", description: "Clear communication and dependable service support lasting customer relationships.", body: fallbackMarketingSettings.aboutBody },
  photos: { eyebrow: "Gallery", title: "A look around the shop", description: "Approved facility, team, and service photos can be shared here.", body: null },
  contact: { eyebrow: "Contact", title: "Let’s talk about your vehicle", description: fallbackMarketingSettings.contactIntro, body: null },
} as const;

export const fallbackCoupons = [{ id: "fallback-maintenance", title: "Ask About Current Offers", body: "Contact the shop to learn whether a current maintenance or service offer applies to your visit.", terms: "Availability and terms are confirmed by the shop." }];
export const fallbackTestimonials = [{ id: "fallback-review", quote: "Verified customer feedback will appear here after shop approval.", attribution: "Review placeholder", rating: 5 }];
export const fallbackGallery = ["Front of shop", "Customer area", "Service bays", "Team at work", "Diagnostic equipment", "Community moment"].map((title, index) => ({ id: `fallback-${index}`, title, caption: null, imageUrl: null }));

export const getMarketingSettings = cache(async () => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackMarketingSettings;
  try {
    const settings = await prisma.marketingSetting.findUnique({ where: { shopId: shop.id } });
    return { ...fallbackMarketingSettings, ...Object.fromEntries(Object.entries(settings ?? {}).filter(([, value]) => value !== null)) };
  } catch { return fallbackMarketingSettings; }
});

export const getMarketingPage = cache(async (slug: keyof typeof fallbackPages) => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackPages[slug];
  try { return await prisma.marketingPage.findFirst({ where: { shopId: shop.id, slug, active: true }, select: { eyebrow: true, title: true, description: true, body: true } }) ?? fallbackPages[slug]; }
  catch { return fallbackPages[slug]; }
});

export const getMarketingServices = cache(async () => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return [...marketingServices];
  try { const rows = await prisma.marketingService.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true, summary: true, detail: true } }); return rows.length ? rows : [...marketingServices]; }
  catch { return [...marketingServices]; }
});

export const getMarketingCoupons = cache(async () => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackCoupons;
  try {
    return await prisma.marketingCoupon.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { id: true, title: true, body: true, terms: true } });
  } catch {
    return fallbackCoupons;
  }
});

export const getMarketingTestimonials = cache(async () => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackTestimonials;
  try {
    return await prisma.marketingTestimonial.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, quote: true, attribution: true, rating: true } });
  } catch {
    return fallbackTestimonials;
  }
});

export const getMarketingGallery = cache(async () => {
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackGallery;
  try {
    return await prisma.marketingGalleryItem.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { id: true, title: true, caption: true, imageUrl: true } });
  } catch {
    return fallbackGallery;
  }
});
