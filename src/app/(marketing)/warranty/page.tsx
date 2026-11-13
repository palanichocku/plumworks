import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { CarDocWarrantyBadge } from "@/components/marketing/car-doc-warranty-badge";
import { getPublicShop } from "@/lib/marketing";
import { getPublicWarrantyPrograms } from "@/lib/marketing-warranty";
import { getPublicSeoShop, localTitle, marketingMetadata } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  const [shop, warranties] = await Promise.all([getPublicSeoShop(), Promise.resolve(getPublicWarrantyPrograms())]);
  return marketingMetadata({
    title: localTitle("Warranty Information", shop),
    description: `Learn about nationwide warranty programs available for qualifying repairs at ${shop.name}. Eligibility, limitations and claim procedures depend on the applicable program.`,
    path: "/warranty",
    siteName: shop.name,
    index: warranties.length > 0,
  });
}

export default async function WarrantyPage() {
  const warranties = getPublicWarrantyPrograms();
  if (!warranties.length) notFound();
  const shop = await getPublicShop();

  return <>
    <MarketingPageHero
      eyebrow="Repair warranty"
      title="Warranty Protection for Qualifying Repairs"
      description={`${shop.name} participates in nationwide warranty programs for eligible repairs. Ask our team which coverage applies to your repair before authorizing service.`}
    />
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="grid gap-5 md:grid-cols-2">
        {warranties.map((program) => <article key={program.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex justify-center"><CarDocWarrantyBadge program={program} className="h-auto w-full max-w-48" /></div>
          <div className="mt-4 text-sm font-black uppercase tracking-wider text-orange-700">Participating nationwide warranty program</div>
          <h2 className="mt-3 text-2xl font-black text-slate-950">{program.title}</h2>
          <p className="mt-4 text-xl font-bold text-slate-900">{program.duration} / {program.miles}</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">Car Doc participates in this third-party warranty program. The badge is Car Doc informational artwork, not an official provider logo. For qualifying repairs only. Coverage depends on the program&apos;s current written terms, covered services, mileage, limitations and exclusions. Not every repair is eligible.</p>
          <a href={program.url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block rounded-xl border border-slate-300 px-4 py-2.5 font-bold text-slate-900 hover:border-orange-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Read program information ↗</a>
        </article>)}
      </div>
      <div className="mt-10 rounded-2xl bg-slate-50 p-6 sm:p-8">
        <h2 className="text-2xl font-black text-slate-950">How can I tell if my repair is covered?</h2>
        <p className="mt-3 leading-7 text-slate-700">Coverage varies by program, vehicle, repair and location. Ask the shop which warranty, if any, applies to the specific work on your estimate or invoice. Keep your repair paperwork for any future claim. Program administrators may require additional documentation and have specific claim procedures.</p>
        <p className="mt-4 text-sm leading-6 text-slate-600">The displayed durations and mileage are program maximums, not a promise that every repair is covered. The applicable written warranty terms govern.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/appointment" className="rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Request Service</Link>
          <Link href="/contact" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Ask About Coverage</Link>
        </div>
      </div>
    </section>
  </>;
}
