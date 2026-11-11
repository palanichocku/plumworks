import type { Metadata } from "next";
import Link from "next/link";
import { SmsConsentCustomerFlow } from "@/components/sms-consent-customer-flow";
import { smsConsentText } from "@/lib/messaging/sms-consent";

export const metadata: Metadata = {
  title: "Car Doc SMS Opt-In Process — Review Evidence",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Reviewer-accessible evidence for A2P vetting.
 * Renders the real consent UI with anonymized example data, rather than a
 * separate invented consent form. No customer data, tokens or working
 * enrollment requests are exposed on this page.
 */
export default function SmsOptInProofPage() {
  const shopName = "Car Doc";
  const disclosure = smsConsentText(shopName);
  return <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950">
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-600">Car Doc · SMS Consent</p>
        <h1 className="mt-2 text-3xl font-bold">Customer opt-in process — review evidence</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          This public demonstration shows the actual customer-facing consent component used in PlumWorks.
          All personal information is replaced with an example. This proof page cannot register
          consent or send a text message.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          At vehicle intake, authorized shop staff open a customer record and start an optional SMS
          consent request. The customer uses the shop iPad or scans a QR code on their own phone.
          A phone-based request first requires a six-digit code given by the shop after verifying
          the customer. Valid requests expire after ten minutes and can be completed only once.
        </p>
        <p className="mt-3 text-sm">
          <Link className="underline" href="/privacy">Privacy Policy</Link>{" · "}
          <Link className="underline" href="/sms-terms">SMS Terms &amp; Conditions</Link>
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Step 1 — Customer phone QR-code verification</h2>
        <p className="text-sm text-slate-700">The customer scans the QR code and enters the six-digit code provided at the shop. This is the actual PIN screen.</p>
        <div aria-label="Nonfunctional demonstration of PIN screen" className="pointer-events-none select-none overflow-hidden rounded-2xl border border-slate-300">
          <SmsConsentCustomerFlow token="DEMO_ONLY_NO_VALID_TOKEN" shopName={shopName} customerName="Sample Customer" phone="(***) ***-0123" disclosure={disclosure} method="IN_SHOP_QR" />
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Step 2 — Customer chooses whether to receive SMS</h2>
        <p className="text-sm text-slate-700">The iPad shows this form immediately; customers using their phone see the same consent form after PIN verification. The checkbox starts unchecked. Customers may choose Decline.</p>
        <div aria-label="Nonfunctional demonstration of actual customer opt-in form" className="pointer-events-none select-none overflow-hidden rounded-2xl border border-slate-300">
          <SmsConsentCustomerFlow token="DEMO_ONLY_NO_VALID_TOKEN" shopName={shopName} customerName="Sample Customer" phone="(***) ***-0123" disclosure={disclosure} method="IN_SHOP_IPAD" />
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-bold">Step 3 — Confirmation after submission</h2>
        <p className="mt-3 text-sm text-slate-700">The customer receives this confirmation after consent is recorded:</p>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <div className="font-bold">Thank you!</div>
          <p className="mt-2">Your text message preference has been saved.</p>
          <p className="mt-2 text-sm">You can now close this screen.</p>
        </div>
        <p className="mt-3 text-sm text-slate-700">If the customer declines, the application instead confirms: “Your choice has been recorded. You will not be enrolled in text messages through this request.”</p>
        <p className="mt-3 text-sm text-slate-700">PlumWorks stores the decision, phone number, timestamp, disclosure, and collection method. Enrollment is optional, separate from authorization to perform repairs, and not required to receive service.</p>
      </section>
    </div>
  </div>;
}
