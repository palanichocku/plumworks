import type { Metadata } from "next";
import { LeadForm } from "@/components/marketing/lead-form";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicSeoShop, localTitle, marketingMetadata } from "@/lib/marketing-seo";
export async function generateMetadata(): Promise<Metadata> { const shop = await getPublicSeoShop(); return marketingMetadata({ title: localTitle("Request Auto Repair Service", shop), description: `Request service from ${shop.name} and share your vehicle, preferred timing, and repair or maintenance concern. The shop will follow up to confirm availability.`, path: "/appointment", siteName: shop.name }); }
export default async function AppointmentPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) { const query = await searchParams; return <><MarketingPageHero eyebrow="Appointment" title="Request a convenient service time" description="This is an appointment request. The shop will contact you to confirm availability." /><section className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><LeadForm source="APPOINTMENT" sent={query.sent === "1"} error={query.error === "1"} /></section></>; }
