import type { MetadataRoute } from "next";
import { getMarketingCoupons, getMarketingGallery, getMarketingServices, getMarketingTestimonials } from "@/lib/marketing-content";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const routes = ["", "/services", "/about", "/contact", "/appointment", "/drop-off"];
  const [services, coupons, testimonials, gallery] = await Promise.all([getMarketingServices(), getMarketingCoupons(), getMarketingTestimonials(), getMarketingGallery()]);
  if (coupons.some((item) => !item.id.startsWith("fallback-"))) routes.push("/coupons");
  if (testimonials.some((item) => !item.id.startsWith("fallback-"))) routes.push("/reviews");
  if (gallery.some((item) => !item.id.startsWith("fallback-") && item.imageUrl)) routes.push("/photos");
  return [...routes, ...services.map(({ slug }) => `/services/${slug}`)].map((route) => ({ url: `${base}${route}`, changeFrequency: "monthly", priority: route === "" ? 1 : 0.7 }));
}
