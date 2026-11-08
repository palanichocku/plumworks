import type { Metadata } from "next";
import Link from "next/link";
import { getConsentPage, SMS_CONSENT_TEXT } from "@/lib/messaging/sms-consent";
import { submitSmsConsent } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SMS Consent", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function SmsConsentPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const session = await getConsentPage(token).catch(() => null);
  if (!session) return <main className="mx-auto max-w-xl p-8 text-slate-900"><h1 className="text-2xl font-bold">Consent session unavailable</h1><p className="mt-3">This one-time link has expired or has already been used. Ask shop staff for another.</p></main>;
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:py-12">
    <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="text-sm font-bold uppercase tracking-wide text-brand-primary">Text message consent</p>
      <h1 className="mt-2 text-2xl font-bold">{session.shopName}</h1>
      <p className="mt-3 text-sm text-slate-700">Mobile number: <strong>{session.phone}</strong>. Check that these last four digits are yours before signing up.</p>
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">The PIN was incorrect or this session is no longer available. Try again or ask staff for a new link.</p> : null}
      <form action={submitSmsConsent} className="mt-6 space-y-5">
        <input type="hidden" name="token" value={token} />
        <label className="block text-sm font-semibold">Your full name
          <input name="customerName" required minLength={2} maxLength={120} autoComplete="name" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base" />
        </label>
        <label className="block text-sm font-semibold">One-time security PIN from shop staff
          <input name="pin" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="off" className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-lg tracking-wider" />
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
          <input type="checkbox" name="smsOptIn" value="yes" className="mt-1 h-5 w-5 shrink-0" />
          <span>{SMS_CONSENT_TEXT}</span>
        </label>
        <p className="text-sm text-slate-600">You may leave the checkbox unchecked. Declining text messages will not affect your repair service.</p>
        <p className="text-xs leading-5 text-slate-600"><Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</Link> · <Link href="/sms-terms" target="_blank" rel="noopener noreferrer" className="underline">SMS Terms & Conditions</Link></p>
        <button className="min-h-12 w-full rounded-lg bg-brand-primary px-5 py-3 text-base font-bold text-white">Submit my choice</button>
      </form>
    </section>
  </main>;
}
