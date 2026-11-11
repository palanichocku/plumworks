"use server";

import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createConsentSession, getSmsConsentStatus, getSmsConsentHistory,
  getSmsConsentSessionProgress, cancelSmsConsentSession } from "@/lib/messaging/sms-consent";

export type SmsConsentStatus = "CONSENTED" | "OPTED_OUT" | "DECLINED" | "MISSING";
export type SmsConsentSessionState = { status: "idle" | "error" | "ready"; message: string;
  link?: string; pin?: string; expiresAt?: string; sessionId?: string;
  method?: "IN_SHOP_IPAD" | "IN_SHOP_QR"; phone?: string };

async function staffCustomer(customerId: string) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership || !hasPermission(membership.role, "edit_customer_vehicle")) return null;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId: membership.shopId, archivedAt: null },
    select: { id: true, phone: true },
  });
  return customer ? { customer, membership, user } : null;
}

export async function startSmsConsentSessionAction(_previous: SmsConsentSessionState, form: FormData): Promise<SmsConsentSessionState> {
  const customerId = String(form.get("customerId") ?? "");
  const method = form.get("method");
  const context = await staffCustomer(customerId);
  if (!context) return { status: "error", message: "You do not have permission to collect SMS consent." };
  if (method !== "IN_SHOP_IPAD" && method !== "IN_SHOP_QR")
    return { status: "error", message: "Choose the collection device." };

  try {
    const status = await getSmsConsentStatus(context.membership.shopId, customerId, context.customer.phone);
    if (status === "OPTED_OUT")
      return { status: "error", message: "This number opted out. Do not create a new consent session until STOP suppression has been properly resolved with the provider." };
    const session = await createConsentSession({
      shopId: context.membership.shopId, customerId, staffId: context.user.id, method,
    });
    return {
      status: "ready", message: method === "IN_SHOP_QR"
        ? "Ask the customer to scan the QR code, then provide the PIN in person."
        : "Open the customer-only screen and hand over the iPad.",
      link: `https://dev.subbuscardoc.com/sms-consent/${session.token}`,
      pin: method === "IN_SHOP_QR" ? session.pin : undefined,
      expiresAt: session.expiresAt.toISOString(), sessionId: session.id, method, phone: session.phone,
    };
  } catch {
    return { status: "error", message: "Could not start consent. Verify the customer's primary mobile number and the Development database." };
  }
}

export async function getCustomerSmsConsentOverviewAction(customerId: string, sessionId?: string) {
  const context = await staffCustomer(customerId);
  if (!context) return null;
  const shopId = context.membership.shopId;
  const [status, history, progress] = await Promise.all([
    getSmsConsentStatus(shopId, customerId, context.customer.phone),
    getSmsConsentHistory(shopId, customerId),
    sessionId ? getSmsConsentSessionProgress(shopId, customerId, sessionId) : Promise.resolve(null),
  ]);
  return { status, history, progress };
}

export async function cancelCustomerSmsConsentSessionAction(customerId: string, sessionId: string) {
  const context = await staffCustomer(customerId);
  if (!context) return false;
  await cancelSmsConsentSession(context.membership.shopId, customerId, sessionId);
  return true;
}

export async function getCustomerSmsConsentStatusAction(customerId: string): Promise<SmsConsentStatus> {
  const context = await staffCustomer(customerId);
  if (!context) return "MISSING";
  return getSmsConsentStatus(context.membership.shopId, customerId, context.customer.phone);
}
