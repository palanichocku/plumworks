import type { Metadata } from "next";
import { LeadForm } from "@/components/marketing/lead-form";
import { MarketingPageHero } from "@/components/marketing/page-hero";
export const metadata: Metadata = { title: "Request an Appointment", description: "Request an auto repair appointment and share basic vehicle and service details." };
export default async function AppointmentPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) { const query = await searchParams; return <><MarketingPageHero eyebrow="Appointment" title="Request a convenient service time" description="Tell us what your vehicle needs and when you would like to visit. The shop will follow up to confirm availability." /><section className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><LeadForm source="APPOINTMENT" sent={query.sent === "1"} /></section></>; }
