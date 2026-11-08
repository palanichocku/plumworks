import type { Metadata } from "next";
import Link from "next/link";
import { getPublicSeoShop, marketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
 const shop = await getPublicSeoShop();
 return marketingMetadata({ title: `SMS Terms & Conditions | ${shop.name}`, description: "Terms for repair-estimate and vehicle-service text alerts.", path: "/sms-terms", siteName: shop.name });
}
export default async function SmsTermsPage() {
 const shop = await getPublicSeoShop();
 return <main className="mx-auto max-w-3xl px-5 py-12 text-slate-900">
 <h1 className="text-3xl font-bold">SMS Terms &amp; Conditions</h1>
 <p className="mt-4">The {shop.name} customer-care text messaging program sends repair estimate links, authorization reminders, and vehicle service updates only to customers who choose to opt in.</p>
 <h2 className="mt-7 text-xl font-bold">Consent and frequency</h2>
 <p className="mt-2">Participation is optional and is not a condition of purchasing goods or services. Message frequency varies with your vehicle service activity. Message and data rates may apply.</p>
 <h2 className="mt-7 text-xl font-bold">Stopping messages and getting help</h2>
 <p className="mt-2"><strong>Reply STOP to unsubscribe</strong> from SMS messages. <strong>Reply HELP for assistance.</strong> You can also contact the shop through its <Link href="/contact" className="underline">Contact page</Link>. Your carrier may also offer text blocking settings.</p>
 <h2 className="mt-7 text-xl font-bold">Delivery and changes</h2>
 <p className="mt-2">Wireless carriers are not liable for delayed or undelivered messages. We may adjust or end SMS notifications. Other ways to contact the shop remain available.</p>
 <p className="mt-7">For more information, see our <Link href="/privacy" className="underline">Privacy Policy</Link>. SMS enrollment does not constitute approval for vehicle repairs; each estimate requires separate authorization.</p>
 <p className="mt-4 text-xs text-slate-600">Last updated November 8, 2026.</p>
 </main>;
}
