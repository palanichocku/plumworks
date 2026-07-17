import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { marketingServices } from "@/lib/marketing-services";

export const metadata: Metadata = { title: "Auto Repair Services", description: "Explore common maintenance, diagnostic, brake, tire, electrical, and repair services." };
export default function ServicesPage() { return <><MarketingPageHero eyebrow="Services" title="Practical care for everyday driving" description="Start with the concern you notice or the maintenance you know is due. The shop will help confirm the right next step." /><section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{marketingServices.map((service) => <Link key={service.slug} href={`/services/${service.slug}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-orange-300"><p className="text-xs font-black uppercase tracking-widest text-orange-600">Auto care</p><h2 className="mt-3 text-xl font-black">{service.name}</h2><p className="mt-3 text-sm leading-6 text-slate-600">{service.summary}</p><p className="mt-5 text-sm font-bold text-orange-600">Learn more →</p></Link>)}</div></section></>; }
