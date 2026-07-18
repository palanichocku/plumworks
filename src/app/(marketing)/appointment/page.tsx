import type { Metadata } from "next";
import { LeadForm } from "@/components/marketing/lead-form";
import { MarketingPageHero } from "@/components/marketing/page-hero";
export const metadata: Metadata = { title: "Request an Appointment", description: "Request an auto repair appointment and share basic vehicle and service details." };
export default async function AppointmentPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) { const query = await searchParams; return <><MarketingPageHero eyebrow="Appointment" title="Request a convenient service time" description="This is an appointment request. The shop will contact you to confirm availability." /><section className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><LeadForm source="APPOINTMENT" sent={query.sent === "1"} error={query.error === "1"} /></section></>; }
