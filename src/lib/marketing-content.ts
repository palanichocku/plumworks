import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getPublicShop } from "@/lib/marketing";
import { marketingServices } from "@/lib/marketing-services";
import { marketingContentTablesAvailable } from "@/lib/marketing-schema";
import { getMarketingContentPreview } from "@/lib/marketing-content-preview";
import { decodeServiceDetail } from "@/lib/marketing-service-content";

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
export const fallbackTestimonials = [{ id: "fallback-review", quote: "Verified customer feedback will appear here after shop approval.", attribution: "Review placeholder", rating: null }];
export const fallbackGallery = ["Front of shop", "Customer area", "Service bays", "Team at work", "Diagnostic equipment", "Community moment"].map((title, index) => ({ id: `fallback-${index}`, title, caption: null, imageUrl: null }));

export const getMarketingSettings = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return { ...fallbackMarketingSettings, ...Object.fromEntries(Object.entries(preview.settings).filter(([, value]) => value !== null)) };
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackMarketingSettings;
  try {
    const settings = await prisma.marketingSetting.findUnique({ where: { shopId: shop.id } });
    return { ...fallbackMarketingSettings, ...Object.fromEntries(Object.entries(settings ?? {}).filter(([, value]) => value !== null)) };
  } catch { return fallbackMarketingSettings; }
});

export const getMarketingPage = cache(async (slug: keyof typeof fallbackPages) => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.pages.find((page) => page.slug === slug && page.active) ?? fallbackPages[slug];
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackPages[slug];
  try { return await prisma.marketingPage.findFirst({ where: { shopId: shop.id, slug, active: true }, select: { eyebrow: true, title: true, description: true, body: true } }) ?? fallbackPages[slug]; }
  catch { return fallbackPages[slug]; }
});

export const getMarketingAboutOwner = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.aboutOwner;
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return null;
  try {
    const page = await prisma.marketingPage.findFirst({ where: { shopId: shop.id, slug: "about-owner", active: true }, select: { eyebrow: true, title: true, description: true, body: true } });
    if (!page?.eyebrow || !page.body) return null;
    const details = JSON.parse(page.body) as unknown;
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const { biography, imageUrl, imageAlt, homepageSummary, historyLabel, principles } = details as Record<string, unknown>;
    if (typeof biography !== "string" || (imageUrl != null && (typeof imageUrl !== "string" || !imageUrl.startsWith("/client-assets/"))) || (imageAlt != null && typeof imageAlt !== "string")) return null;
    return { heading: page.eyebrow, name: page.title, role: page.description, biography, imageUrl: typeof imageUrl === "string" ? imageUrl : null, imageAlt: typeof imageAlt === "string" ? imageAlt : null, homepageSummary: typeof homepageSummary === "string" ? homepageSummary : null, historyLabel: typeof historyLabel === "string" ? historyLabel : null, principles: Array.isArray(principles) ? principles.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [] };
  } catch { return null; }
});

export const getMarketingBrandName = cache(async (): Promise<string | null> => {
  const preview = await getMarketingContentPreview();
  if (preview?.brandName) return preview.brandName;
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return null;
  try {
    return (await prisma.marketingPage.findFirst({ where: { shopId: shop.id, slug: "marketing-brand", active: true }, select: { title: true } }))?.title?.trim() || null;
  } catch { return null; }
});

export const getMarketingServices = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.services.filter((item) => item.active).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.previewIndex - right.previewIndex).map(({ slug, name, summary, detail }) => ({ slug, name, summary, ...decodeServiceDetail(detail) }));
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return marketingServices.map((service) => ({ ...service, content: null }));
  try { const rows = await prisma.marketingService.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true, summary: true, detail: true } }); return rows.length ? rows.map(({ detail, ...service }) => ({ ...service, ...decodeServiceDetail(detail) })) : marketingServices.map((service) => ({ ...service, content: null })); }
  catch { return marketingServices.map((service) => ({ ...service, content: null })); }
});

export const getMarketingCoupons = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.coupons.filter((item) => item.active).sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title) || left.previewIndex - right.previewIndex).map(({ id, title, body, terms }) => ({ id, title, body, terms }));
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackCoupons;
  try {
    return await prisma.marketingCoupon.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { id: true, title: true, body: true, terms: true } });
  } catch {
    return fallbackCoupons;
  }
});

export const getMarketingTestimonials = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.testimonials.filter((item) => item.active).sort((left, right) => left.sortOrder - right.sortOrder || left.previewIndex - right.previewIndex).map(({ id, quote, attribution, rating }) => ({ id, quote, attribution, rating }));
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackTestimonials;
  try {
    return await prisma.marketingTestimonial.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, quote: true, attribution: true, rating: true } });
  } catch {
    return fallbackTestimonials;
  }
});

export const getMarketingGallery = cache(async () => {
  const preview = await getMarketingContentPreview();
  if (preview) return preview.gallery.filter((item) => item.active).sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title) || left.previewIndex - right.previewIndex).map(({ id, title, caption, imageUrl }) => ({ id, title, caption, imageUrl }));
  const shop = await getPublicShop();
  if (!shop.id || !await marketingContentTablesAvailable()) return fallbackGallery;
  try {
    return await prisma.marketingGalleryItem.findMany({ where: { shopId: shop.id, active: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], select: { id: true, title: true, caption: true, imageUrl: true } });
  } catch {
    return fallbackGallery;
  }
});
