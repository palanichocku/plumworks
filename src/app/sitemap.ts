import type { MetadataRoute } from "next";
import { getMarketingServices } from "@/lib/marketing-content";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const routes = ["", "/services", "/coupons", "/reviews", "/about", "/photos", "/contact", "/appointment", "/drop-off"];
  const services = await getMarketingServices();
  return [...routes, ...services.map(({ slug }) => `/services/${slug}`)].map((route) => ({ url: `${base}${route}`, changeFrequency: "monthly", priority: route === "" ? 1 : 0.7 }));
}
