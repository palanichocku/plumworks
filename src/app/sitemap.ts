import type { MetadataRoute } from "next";
import { marketingServices } from "@/lib/marketing-services";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const routes = ["", "/services", "/coupons", "/reviews", "/about", "/photos", "/contact", "/appointment", "/drop-off"];
  return [...routes, ...marketingServices.map(({ slug }) => `/services/${slug}`)].map((route) => ({ url: `${base}${route}`, changeFrequency: "monthly", priority: route === "" ? 1 : 0.7 }));
}
