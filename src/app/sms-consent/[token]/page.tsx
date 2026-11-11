import type { Metadata } from "next";
import { getCurrentMembership } from "@/lib/data/membership";
import { getConsentPage } from "@/lib/messaging/sms-consent";
import { SmsConsentCustomerFlow } from "@/components/sms-consent-customer-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SMS Consent", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SmsConsentPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const { user, membership } = await getCurrentMembership();
  const staff = user && membership ? { userId: user.id, shopId: membership.shopId } : undefined;
  const session = await getConsentPage(token, staff).catch(() => null);
  if (!session) return <main className="mx-auto max-w-xl p-8 text-slate-900">
    <h1 className="text-2xl font-bold">Consent session unavailable</h1>
    <p className="mt-3">The link expired, was already used, or cannot be opened on this device. Ask shop staff for another.</p>
  </main>;
  return <SmsConsentCustomerFlow token={token} shopName={session.shopName} customerName={session.customerName} phone={session.phone}
    disclosure={session.disclosure} method={session.method} error={Boolean(error)} />;
}
