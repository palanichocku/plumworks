import { AttributionLink } from "@/components/marketing/attribution-link";
import { TrackedCallLink } from "@/components/marketing/tracked-call-link";
import { phoneHref, type PublicShop } from "@/lib/marketing";

export function EmptyMarketingCollection({ shop, message }: { shop: PublicShop; message: string }) {
  return <section className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-16">
    <p className="text-base leading-7 text-slate-600">{message}</p>
    <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
      <AttributionLink href="/appointment" className="rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Request Service</AttributionLink>
      {shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Call {shop.phone}</TrackedCallLink> : null}
      <AttributionLink href="/services" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">View Services</AttributionLink>
      <AttributionLink href="/" className="rounded-xl px-5 py-3 font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Return Home</AttributionLink>
    </div>
  </section>;
}
