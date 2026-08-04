import { callClickMessage } from "@/lib/marketing-lead-context";
import { prisma } from "@/lib/prisma";
import { cookies, headers } from "next/headers";
import { leadAttributionData, marketingAttributionCookie, normalizeAttributionPath } from "@/lib/marketing-attribution";

export async function POST() {
  try {
    const requestHeaders = await headers();
    const referrer = requestHeaders.get("referer");
    let submissionPath = "/";
    try { submissionPath = normalizeAttributionPath(referrer ? new URL(referrer).pathname : null) || "/"; } catch { submissionPath = "/"; }
    const attribution = leadAttributionData((await cookies()).get(marketingAttributionCookie)?.value, submissionPath);
    const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
    if (shops.length === 1) {
      await prisma.marketingLead.create({
        data: {
          shopId: shops[0].id,
          source: "CONTACT",
          status: "NEW",
          name: "Website visitor",
          message: callClickMessage,
          ...attribution,
        },
      });
    }
  } catch {
    // Tracking is intentionally best-effort and must never interfere with calling.
  }

  return new Response(null, { status: 204 });
}
