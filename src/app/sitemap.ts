import type { MetadataRoute } from "next";
import { getMarketingCoupons, getMarketingGallery, getMarketingServices, getMarketingTestimonials } from "@/lib/marketing-content";
import { configuredPublicSiteOrigin, marketingIndexingEnabled } from "@/lib/marketing-seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = configuredPublicSiteOrigin();
  if (!origin || !marketingIndexingEnabled()) return [];
  const routes = ["/", "/services", "/about", "/contact", "/appointment", "/drop-off", "/privacy"];
  const [services, coupons, testimonials, gallery] = await Promise.all([getMarketingServices(), getMarketingCoupons(), getMarketingTestimonials(), getMarketingGallery()]);
  if (coupons.some((item) => !item.id.startsWith("fallback-"))) routes.push("/coupons");
  if (testimonials.some((item) => !item.id.startsWith("fallback-"))) routes.push("/reviews");
  if (gallery.some((item) => !item.id.startsWith("fallback-") && item.imageUrl)) routes.push("/photos");
  return [...routes, ...services.map(({ slug }) => `/services/${slug}`)].map((route) => ({ url: new URL(route, origin).href }));
}
