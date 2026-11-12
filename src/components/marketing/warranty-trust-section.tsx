import Link from "next/link";
import { getPublicWarrantyPrograms } from "@/lib/marketing-warranty";

export function WarrantyTrustSection() {
  const warranties = getPublicWarrantyPrograms();
  if (!warranties.length) return null;
  return <section aria-labelledby="warranty-trust-title" className="border-b border-slate-200 bg-orange-50">
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-black uppercase tracking-widest text-orange-800">Extra confidence in your repair</p>
          <h2 id="warranty-trust-title" className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Nationwide warranty protection for eligible repairs</h2>
          <p className="mt-3 text-slate-700">{warranties.map((program) => `${program.title}: up to ${program.duration} / ${program.miles}`).join(" · ")}. Specific coverage, limitations and exclusions vary by repair and program.</p>
        </div>
        <Link href="/warranty" className="shrink-0 rounded-xl bg-slate-950 px-5 py-3 text-center font-black text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">See Warranty Details</Link>
      </div>
    </div>
  </section>;
}
