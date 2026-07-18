import { callClickMessage } from "@/lib/marketing-lead-context";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
    if (shops.length === 1) {
      await prisma.marketingLead.create({
        data: {
          shopId: shops[0].id,
          source: "CONTACT",
          status: "NEW",
          name: "Website visitor",
          message: callClickMessage,
        },
      });
    }
  } catch {
    // Tracking is intentionally best-effort and must never interfere with calling.
  }

  return new Response(null, { status: 204 });
}
