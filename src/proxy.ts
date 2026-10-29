import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { marketingAttributionCookie, parseFirstTouch, preserveFirstTouch } from "@/lib/marketing-attribution";
import { resolveCardocLegacyRedirect } from "@/lib/cardoc-legacy-redirects";

const PUBLIC_WEBSITE_HOST = "www.subbuscardoc.com";
const PRODUCTION_APP_HOST = "app.subbuscardoc.com";

const publicMarketingPaths = new Set(["/", "/about", "/appointment", "/contact", "/coupons", "/drop-off", "/photos", "/privacy", "/reviews", "/services", "/terms"]);
const publicAppPaths = new Set(["/login", "/forgot-password", "/auth/callback", "/update-password", "/invite"]);
const protectedAppPrefixes = ["/dashboard", "/leads", "/customers", "/vehicles", "/repair-orders", "/open-orders", "/invoices", "/accounts-receivable", "/reports", "/search", "/help", "/admin", "/settings"];

function isPublicMarketingPath(pathname: string) {
  return publicMarketingPaths.has(pathname) || pathname.startsWith("/services/");
}

function isPublicAuthorizationPath(pathname: string) {
  return pathname.startsWith("/authorize/repair-order/");
}

function isHealthPath(pathname: string) {
  return pathname === "/api/health";
}

function isFrameworkAsset(pathname: string) {
  return pathname.startsWith("/_next/") ||
    pathname.startsWith("/client-assets/") ||
    pathname.startsWith("/brand/") ||
    pathname === "/favicon.ico";
}

function isAppPath(pathname: string) {
  return publicAppPaths.has(pathname) || protectedAppPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToHost(request: NextRequest, host: string, status: 301 | 302 | 307 | 308 = 307) {
  const destination = new URL(request.nextUrl.href);
  destination.protocol = "https:";
  destination.host = host;
  destination.port = "";
  return NextResponse.redirect(destination, status);
}

export async function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  const pathname = request.nextUrl.pathname;

  if (isFrameworkAsset(pathname)) return NextResponse.next();
  if (isHealthPath(pathname)) return NextResponse.next();

  if (request.method === "GET" || request.method === "HEAD") {
    const legacyRedirect = resolveCardocLegacyRedirect(request.nextUrl, request.headers.get("host"));
    if (legacyRedirect) return NextResponse.redirect(legacyRedirect.location, legacyRedirect.status);
  }

  if (hostname === "subbuscardoc.com") {
    return redirectToHost(request, PUBLIC_WEBSITE_HOST, 301);
  }

  if (hostname === PRODUCTION_APP_HOST) {
    if (isPublicAuthorizationPath(pathname)) {
      return redirectToHost(request, PUBLIC_WEBSITE_HOST);
    }
    if (isPublicMarketingPath(pathname)) {
      if (pathname === "/") {
        const dashboardUrl = new URL("/dashboard", request.nextUrl);
        return NextResponse.redirect(dashboardUrl, 307);
      }
      return redirectToHost(request, PUBLIC_WEBSITE_HOST);
    }
    return updateSession(request);
  }

  if (hostname === PUBLIC_WEBSITE_HOST && isAppPath(pathname)) {
    return redirectToHost(request, PRODUCTION_APP_HOST);
  }

  if (request.method === "GET" || request.method === "HEAD") {
    if (/(?:\.html|\.php|\/defaults\/files\/DrivabilityForm\.pdf)$/i.test(pathname)) return NextResponse.next();
  }
  if (isPublicAuthorizationPath(pathname)) return NextResponse.next();
  if (isPublicMarketingPath(pathname)) {
    const response = NextResponse.next();
    const existing = request.cookies.get(marketingAttributionCookie)?.value;
    if ((request.method === "GET" || request.method === "HEAD") && !parseFirstTouch(existing)) {
      response.cookies.set(marketingAttributionCookie, JSON.stringify(preserveFirstTouch(existing, {
        searchParams: request.nextUrl.searchParams,
        pathname,
        origin: request.nextUrl.origin,
        referrer: request.headers.get("referer"),
      })), { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
    }
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "host", value: "subbuscardoc\\.com" }] },
    { source: "/:path*", has: [{ type: "host", value: "www\\.subbuscardoc\\.com" }] },
    { source: "/:path*", has: [{ type: "host", value: "app\\.subbuscardoc\\.com" }] },
    "/login",
    "/forgot-password",
    "/auth/callback",
    "/update-password",
    "/",
    "/about",
    "/appointment",
    "/contact",
    "/coupons",
    "/drop-off",
    "/photos",
    "/privacy",
    "/reviews",
    "/services/:path*",
    "/terms",
    "/authorize/repair-order/:path*",
    "/invite",
    "/dashboard/:path*",
    "/leads/:path*",
    "/customers/:path*",
    "/vehicles/:path*",
    "/repair-orders/:path*",
    "/open-orders/:path*",
    "/invoices/:path*",
    "/accounts-receivable/:path*",
    "/reports/:path*",
    "/search/:path*",
    "/help/:path*",
    "/admin/:path*",
    "/settings/:path*",
    "/((?:.*)\\.html)",
    "/((?:.*)\\.php)",
    "/defaults/files/DrivabilityForm.pdf",
  ],
};
