import type { Metadata } from "next";
import { AttributionLink } from "@/components/marketing/attribution-link";
import { EmptyMarketingCollection } from "@/components/marketing/empty-marketing-collection";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingCoupons, getMarketingPage } from "@/lib/marketing-content";

function approvedOffers<T extends { id: string }>(items: T[]) { return items.filter((item) => !item.id.startsWith("fallback-")); }

export async function generateMetadata(): Promise<Metadata> {
  const hasOffers = approvedOffers(await getMarketingCoupons()).length > 0;
  return { title: "Auto Repair Coupons", description: "View current shop service offers.", robots: hasOffers ? undefined : { index: false, follow: true } };
}

export default async function CouponsPage() {
  const [page, loadedOffers, shop] = await Promise.all([getMarketingPage("coupons"), getMarketingCoupons(), getPublicShop()]);
  const offers = approvedOffers(loadedOffers);
  return <>
    <MarketingPageHero eyebrow={page.eyebrow ?? "Offers"} title={page.title} description={page.description} />
    {offers.length ? <>
      {page.body ? <p className="mx-auto max-w-3xl px-4 pt-12 text-center leading-7 text-slate-600 sm:px-6">{page.body}</p> : null}
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-3">{offers.map((offer) => <article key={offer.id} className="rounded-3xl border-2 border-dashed border-orange-300 bg-white p-7"><p className="text-xs font-black uppercase tracking-widest text-orange-700">Shop offer</p><h2 className="mt-4 text-2xl font-black">{offer.title}</h2><p className="mt-3 leading-7 text-slate-600">{offer.body}</p>{offer.terms ? <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">{offer.terms}</p> : null}</article>)}</section>
      <div className="pb-16 text-center"><AttributionLink href="/appointment" className="rounded-xl bg-orange-600 px-6 py-3.5 font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Request Service</AttributionLink></div>
    </> : <EmptyMarketingCollection shop={shop} message={page.body || "Call the shop to ask about current offers, or send a service request to discuss your vehicle."} />}
  </>;
}
