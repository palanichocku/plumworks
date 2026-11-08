import type { Metadata } from "next";
import Link from "next/link";
import { smsConsentText } from "@/lib/messaging/sms-consent";

export const metadata: Metadata = { title: "SMS Consent Example — Car Doc LLC" };
export default function SmsConsentExample() {
 return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950"><section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
 <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Public example — no data submitted</p>
 <h1 className="mt-2 text-2xl font-bold">Car Doc LLC — SMS consent</h1>
 <p className="mt-3 text-sm text-slate-700">The actual flow begins after the shop verifies the customer in person and displays a one-time form on its iPad or shares a short-lived QR link. Customer mobile digits are masked.</p>
 <div className="mt-5 space-y-4 opacity-90">
 <p className="text-sm">Mobile number: (***) ***-1234</p>
 <div className="rounded-lg border border-slate-300 px-3 py-3 text-slate-500">Customer full name (example)</div>
 <div className="rounded-lg border border-slate-300 px-3 py-3 text-slate-500">Customer mobile phone number (example)</div>
 <div className="rounded-lg border border-slate-300 px-3 py-3 text-slate-500">One-time PIN (example)</div>
 <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6"><input type="checkbox" disabled defaultChecked={false} className="mt-1 h-5 w-5" /><span>{smsConsentText("Car Doc LLC")}</span></label>
 <div className="text-xs"><Link href="/privacy" className="underline">Privacy Policy</Link> · <Link href="/sms-terms" className="underline">SMS Terms &amp; Conditions</Link></div>
 <button disabled className="min-h-11 w-full rounded-lg bg-slate-300 px-4 font-bold text-slate-800">Submit my choice (example only)</button>
 </div>
 <p className="mt-4 text-xs text-slate-600">This is a public illustration for campaign review, not a live opt-in form. Checking the box here does not subscribe anyone or send messages.</p>
 </section></main>;
}
