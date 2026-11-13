import Link from "next/link";
import { CarDocWarrantyBadge } from "@/components/marketing/car-doc-warranty-badge";
import { getPublicWarrantyPrograms } from "@/lib/marketing-warranty";

export function WarrantyTrustSection() {
  const warranties = getPublicWarrantyPrograms();
  if (!warranties.length) return null;
  return <section aria-labelledby="warranty-trust-title" className="border-b border-slate-200 bg-orange-50">
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <p className="text-sm font-black uppercase tracking-widest text-orange-800">Extra confidence in your repair</p>
        <h2 id="warranty-trust-title" className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Nationwide warranty protection through participating programs</h2>
        <p className="mt-3 text-slate-700">Car Doc participates in the following nationwide warranty programs for qualifying repairs. The badges below are Car Doc informational artwork, not official program logos.</p>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {warranties.map((program) => <article key={program.id} className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <CarDocWarrantyBadge program={program} className="h-auto w-full max-w-48 sm:max-w-56" />
          <h3 className="mt-3 text-lg font-black text-slate-950">{program.title}</h3>
          <p className="mt-2 text-sm text-slate-700">Car Doc participates in {program.title}. Up to {program.duration} / {program.miles} on qualifying repairs. Coverage and exclusions depend on the applicable program.</p>
          <Link href="/warranty" className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-950 hover:border-orange-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">See Warranty Details</Link>
        </article>)}
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-600">These are third-party program-backed warranties available through Car Doc, not blanket Car Doc warranties. Terms and eligibility apply; ask the shop which program covers your repair.</p>
    </div>
  </section>;
}
