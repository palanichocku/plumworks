import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { marketingAttributionCookie, parseFirstTouch, preserveFirstTouch } from "@/lib/marketing-attribution";

const publicMarketingPaths = new Set(["/", "/about", "/appointment", "/contact", "/coupons", "/drop-off", "/photos", "/privacy", "/reviews", "/services"]);

function isPublicMarketingPath(pathname: string) {
  return publicMarketingPaths.has(pathname) || pathname.startsWith("/services/");
}

export async function proxy(request: NextRequest) {
  if (isPublicMarketingPath(request.nextUrl.pathname)) {
    const response = NextResponse.next();
    const existing = request.cookies.get(marketingAttributionCookie)?.value;
    if ((request.method === "GET" || request.method === "HEAD") && !parseFirstTouch(existing)) {
      response.cookies.set(marketingAttributionCookie, JSON.stringify(preserveFirstTouch(existing, {
        searchParams: request.nextUrl.searchParams,
        pathname: request.nextUrl.pathname,
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
    "/login",
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
    "/invite",
    "/dashboard/:path*",
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
  ],
};
