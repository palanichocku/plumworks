"use server";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { createConsentSession, getSmsConsentStatus } from "@/lib/messaging/sms-consent";

export type SmsConsentSessionState = { status: "idle" | "error" | "ready"; message: string; link?: string; pin?: string; expiresAt?: string };
export async function startSmsConsentSessionAction(_previous: SmsConsentSessionState, form: FormData): Promise<SmsConsentSessionState> {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_customer_vehicle"))
    return { status: "error", message: "You do not have permission to collect SMS consent." };
  const customerId = String(form.get("customerId") ?? "");
  const method = form.get("method");
  if (method !== "IN_SHOP_IPAD" && method !== "IN_SHOP_QR")
    return { status: "error", message: "Choose iPad or QR collection." };
  try {
    const session = await createConsentSession({
      shopId: membership.shopId, customerId, staffId: user.id, method,
    });
    // Always use a fixed canonical non-production origin; never trust Host headers.
    const origin = process.env.SMS_CONSENT_DEV_ORIGIN?.trim() || "https://dev.subbuscardoc.com";
    const url = new URL(origin);
    if (url.origin !== "https://dev.subbuscardoc.com" ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid consent origin.");
    return { status: "ready", message: "Secure consent link is valid for 10 minutes. Verify the customer in person.", link: `${url.origin}/sms-consent/${session.token}`, pin: session.pin, expiresAt: session.expiresAt.toISOString() };
  } catch {
    return { status: "error", message: "Could not prepare consent. Check the customer phone and Development database migration." };
  }
}

export async function getCustomerSmsConsentStatusAction(customerId: string) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_customer_vehicle")) return "MISSING" as const;
  const { prisma } = await import("@/lib/prisma");
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId: membership.shopId }, select: { phone: true },
  });
  if (!customer) return "MISSING" as const;
  try { return await getSmsConsentStatus(membership.shopId, customerId, customer.phone); }
  catch { return "MISSING" as const; }
}
