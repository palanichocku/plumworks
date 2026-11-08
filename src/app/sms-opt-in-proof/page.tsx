import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Car Doc SMS Opt-In Process — Review Evidence",
  description: "Static demonstration of Car Doc's optional customer-care SMS enrollment workflow.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// This evidence page is intentionally presentational only. Do not import the
// development consent component, server actions, messaging services, or Prisma.
const disclosure = "I agree to receive text messages from Car Doc about repair estimates and vehicle service updates at the mobile number shown. Message frequency varies by service activity. Message and data rates may apply. Reply STOP to unsubscribe or HELP for assistance. Consent is optional and is not a condition of purchase.";
const examplePhone = "(***) ***-0123";

function DemoFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return <div aria-label={label} className="rounded-2xl border border-slate-300 bg-slate-100 px-4 py-8 sm:py-12">
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-600">Car Doc</p>
      {children}
    </div>
  </div>;
}
export default function SmsOptInProofPage() {
  return <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-950">
    <div className="mx-auto max-w-3xl space-y-7">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-600">Car Doc · SMS Consent</p>
        <h1 className="mt-2 text-3xl font-bold">Customer opt-in process — review evidence</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">This is a static, non-interactive illustration of the customer-facing enrollment screens. All information is anonymized. No real customer data, PINs, tokens, consent submission, or text messaging is available from this page.</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">At vehicle intake, authorized Car Doc staff offer optional SMS enrollment. A customer may review the disclosure on the shop iPad, or scan a QR code and use a six-digit code given by staff after customer verification on their own phone. Real requests expire after ten minutes and are single-use. The examples below do not issue or accept any code.</p>
        <p className="mt-3 text-sm"><Link className="underline" href="/privacy">Privacy Policy</Link>{" · "}<Link className="underline" href="/sms-terms">SMS Terms &amp; Conditions</Link></p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">Step 1 — Customer phone QR-code verification</h2>
        <p className="text-sm text-slate-700">The customer scans the shop-provided QR code and enters a six-digit verification code. The following shows the phone screen, with no working QR code, PIN, or verification action.</p>
        <DemoFrame label="Static example of QR and PIN verification screen">
          <h3 className="mt-4 text-3xl font-bold tracking-tight">Enter the code from the shop</h3>
          <p className="mt-3 text-slate-600">The person helping you will tell you a six-digit code.</p>
          <p className="mt-7 text-sm font-semibold">Six-digit security code</p>
          <div aria-label="Example code input, inactive" className="mt-2 flex min-h-16 items-center justify-center rounded-xl border-2 border-slate-300 bg-slate-50 px-4 text-center font-mono text-3xl tracking-[0.4em] text-slate-400">••••••</div>
          <div className="mt-6 rounded-xl bg-slate-300 px-5 py-3 text-center font-bold text-slate-600">Continue (demonstration only)</div>
          <p className="mt-6 text-center text-xs text-slate-500">Using your phone · Secure, single-use consent request</p>
        </DemoFrame>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">Step 2 — Customer chooses whether to receive SMS</h2>
        <p className="text-sm text-slate-700">On the shop iPad the form is shown directly. On a customer phone it is shown after PIN verification. The SMS checkbox starts unchecked; customers can decline without affecting repair service.</p>
        <DemoFrame label="Static, non-submitting example of the SMS consent form">
          <h3 className="mt-3 text-3xl font-bold tracking-tight">Get your estimate by text</h3>
          <p className="mt-3 text-slate-600">Choose whether Car Doc may text you repair estimates and service updates. This does not authorize repair work.</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-100 p-4">
            <div><p className="text-xs text-slate-600">Texts will go to</p><p className="text-xl font-bold">{examplePhone}</p></div>
            <span className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Not my number</span>
          </div>
          <p className="mt-6 text-sm font-semibold">Your full name</p>
          <div className="mt-2 min-h-12 rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-400">Example customer name</div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6">
            <span aria-label="Unchecked checkbox" className="mt-1 h-5 w-5 shrink-0 rounded border border-slate-500 bg-white" />
            <span>{disclosure}</span>
          </div>
          <p className="mt-3 text-xs text-slate-600"><Link href="/privacy" className="underline">Privacy Policy</Link>{" · "}<Link href="/sms-terms" className="underline">SMS Terms &amp; Conditions</Link></p>
          <div className="mt-7 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <span className="rounded-xl bg-slate-300 px-3 py-3 text-center text-sm font-bold text-slate-600">Agree and continue</span>
            <span className="rounded-xl border border-slate-300 px-3 py-3 text-center text-sm font-bold text-slate-800">No thanks</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">Illustration only: buttons are not interactive and cannot save consent.</p>
          <p className="mt-6 text-center text-xs text-slate-500">In-shop iPad handoff · Secure, single-use consent request</p>
        </DemoFrame>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-bold">Step 3 — Confirmation after a customer's choice</h2>
        <p className="mt-3 text-sm text-slate-700">After a real enrollment decision is recorded in the Development workflow, the customer sees:</p>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <p className="font-bold">Thank you!</p><p className="mt-2">Your text message preference has been saved.</p>
          <p className="mt-2 text-sm">You can now close this screen.</p>
        </div>
        <p className="mt-3 text-sm text-slate-700">If the customer declines, the confirmation instead reads: “Your choice has been recorded. You will not be enrolled in text messages through this request.”</p>
        <p className="mt-3 text-sm text-slate-700">The consent workflow records the decision, number, timestamp, disclosure, and collection method. Enrollment is optional, independent of permission to perform repairs, and is not required for service. This proof page does not store or transmit anything.</p>
      </section>
    </div>
  </main>;
}
