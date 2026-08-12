import type { MetadataRoute } from "next";
import { configuredPublicSiteOrigin, marketingIndexingEnabled } from "@/lib/marketing-seo";
const privateRoutes = ["/login", "/invite", "/dashboard", "/customers", "/vehicles", "/repair-orders", "/invoices", "/accounts-receivable", "/open-orders", "/reports", "/admin", "/settings", "/search", "/help"];
export default function robots(): MetadataRoute.Robots { const origin = configuredPublicSiteOrigin(); if (!origin || !marketingIndexingEnabled()) return { rules: { userAgent: "*", disallow: "/" } }; return { rules: { userAgent: "*", allow: "/", disallow: privateRoutes }, sitemap: new URL("/sitemap.xml", origin).href }; }
