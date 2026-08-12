import type { Metadata } from "next";
import { AttributionLink } from "@/components/marketing/attribution-link";
import { TrackedCallLink } from "@/components/marketing/tracked-call-link";
import { getPublicShop, phoneHref, shopAddress } from "@/lib/marketing";
import { getMarketingCoupons, getMarketingGallery, getMarketingServices, getMarketingSettings, getMarketingTestimonials } from "@/lib/marketing-content";
import { autoRepairJsonLd, getPublicSeoShop, localTitle, marketingMetadata, safeJsonLd } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getPublicSeoShop();
  return marketingMetadata({ title: localTitle("Auto Repair", shop), description: `Auto repair, maintenance, diagnostics, brake service and more in ${shop.city ?? "the local area"}${shop.state ? `, ${shop.state}` : ""}. Contact ${shop.name} to request service or speak with the shop.`, path: "/", siteName: shop.name });
}

const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30 focus-visible:ring-offset-2";

export default async function MarketingHome() {
  const [shop, seoShop, settings, services, coupons, testimonials, gallery] = await Promise.all([
    getPublicShop(), getPublicSeoShop(), getMarketingSettings(), getMarketingServices(), getMarketingCoupons(), getMarketingTestimonials(), getMarketingGallery(),
  ]);
  const address = shopAddress(shop);
  const directionsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const featuredServices = services.filter((service) => service.name.trim() && service.summary.trim()).slice(0, 6);
  const activeTestimonials = testimonials.filter((item) => !item.id.startsWith("fallback-") && item.quote.trim()).slice(0, 3);
  const activeCoupon = coupons.find((item) => !item.id.startsWith("fallback-") && item.title.trim() && item.body.trim());
  const heroImage = gallery.find((item) => !item.id.startsWith("fallback-") && (item.imageUrl?.startsWith("https://") || item.imageUrl?.startsWith("/")));
  const jsonLd = autoRepairJsonLd(seoShop);

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    <section className="overflow-hidden bg-slate-950 text-white">
      <div className="mx-auto grid max-w-7xl lg:min-h-[620px] lg:grid-cols-[1.05fr_.95fr]">
        <div className="flex items-center px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-orange-400">Vehicle service starts with a conversation</p>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{settings.headline}</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">{settings.subheadline}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <AttributionLink href="/appointment" className={`rounded-xl bg-orange-600 px-5 py-3.5 text-center font-black text-white shadow-lg shadow-orange-950/20 transition hover:bg-orange-700 ${focusRing}`}>Request Service</AttributionLink>
              <TrackedCallLink href={phoneHref(shop.phone)} className={`rounded-xl border border-slate-600 px-5 py-3.5 text-center font-black text-white transition hover:border-slate-400 hover:bg-white/5 ${focusRing}`}>{shop.phone ? `Call ${shop.phone}` : "Contact the Shop"}</TrackedCallLink>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">Submitting a request does not confirm an appointment. The shop will follow up about timing and next steps.</p>
            <dl className="mt-9 grid gap-4 border-t border-slate-800 pt-6 text-sm sm:grid-cols-2">
              <div><dt className="font-bold text-slate-400">Hours</dt><dd className="mt-1 font-semibold text-white">{shop.hours}</dd></div>
              <div><dt className="font-bold text-slate-400">Location</dt><dd className="mt-1 font-semibold text-white">{address || "Contact the shop for location details"}</dd></div>
            </dl>
          </div>
        </div>
        {heroImage ? <div role="img" aria-label={heroImage.title} className="min-h-80 bg-slate-800 bg-cover bg-center lg:min-h-full" style={{ backgroundImage: `linear-gradient(180deg, rgb(15 23 42 / .08), rgb(15 23 42 / .38)), url(${JSON.stringify(heroImage.imageUrl)})` }} /> : <div className="relative min-h-80 overflow-hidden border-t border-slate-800 bg-slate-900 lg:min-h-full lg:border-l lg:border-t-0"><div className="absolute inset-0 [background-image:linear-gradient(135deg,transparent_0%,transparent_44%,rgb(249_115_22_/_0.18)_44%,rgb(249_115_22_/_0.18)_56%,transparent_56%),radial-gradient(circle_at_68%_32%,rgb(51_65_85)_0%,transparent_42%)]" /><div className="absolute inset-x-8 bottom-8 rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-sm sm:inset-x-12 sm:bottom-12"><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Start with what you notice</p><p className="mt-3 max-w-md text-xl font-bold leading-8 text-white">Share the warning light, sound, maintenance need, or driving concern. The shop can help plan the next step.</p></div></div>}
      </div>
    </section>

    {featuredServices.length ? <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="max-w-3xl"><p className="text-sm font-black uppercase tracking-widest text-orange-700">Core services</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Help for common vehicle needs</h2><p className="mt-4 text-lg leading-8 text-slate-600">{settings.serviceIntro}</p></div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{featuredServices.map((service, index) => <AttributionLink key={service.slug} href={`/services/${service.slug}`} className={`group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-orange-300 hover:shadow-md ${focusRing}`}><span className="text-sm font-black text-orange-700">{String(index + 1).padStart(2, "0")}</span><h3 className="mt-4 text-xl font-black text-slate-950 group-hover:text-orange-700">{service.name}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{service.summary}</p><span className="mt-5 inline-block text-sm font-bold text-orange-700">Service details →</span></AttributionLink>)}</div>
      <AttributionLink href="/services" className={`mt-8 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 ${focusRing}`}>View all services</AttributionLink>
    </section> : null}

    <section className="bg-white"><div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
      <div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Why choose this shop</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{settings.aboutTitle}</h2><p className="mt-5 whitespace-pre-wrap text-base leading-7 text-slate-600">{settings.aboutBody}</p></div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
        {[["Clear next steps", "Discuss the concern and review the shop’s recommendation before deciding how to proceed."], ["A practical request process", "Share the vehicle and service need online, then confirm availability directly with the shop."], ["Useful service context", "Good records and clear descriptions can make future vehicle decisions easier."]].map(([title, body]) => <article key={title} className="rounded-2xl border border-slate-200 bg-stone-50 p-5"><h3 className="font-black text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>)}
      </div>
    </div></section>

    <section className="border-y border-slate-200 bg-stone-100"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="max-w-3xl"><p className="text-sm font-black uppercase tracking-widest text-orange-700">How requesting service works</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">A request starts the conversation</h2><p className="mt-4 text-slate-600">Your request is not an automatically confirmed appointment. The shop will contact you before timing is finalized.</p></div>
      <ol className="mt-10 grid gap-5 md:grid-cols-3">{[["1", "Tell the shop what is happening", "Share the vehicle, symptoms, maintenance need, or service you are considering."], ["2", "The shop follows up", "The shop reviews the request and contacts you to discuss availability and timing."], ["3", "Review the recommendation", "After the vehicle is evaluated, review the recommendation or estimate before authorizing work."]].map(([number, title, body]) => <li key={number} className="rounded-2xl bg-white p-6 shadow-sm"><span className="flex size-9 items-center justify-center rounded-full bg-orange-100 font-black text-orange-800">{number}</span><h3 className="mt-5 text-lg font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p></li>)}</ol>
      <AttributionLink href="/appointment" className={`mt-8 inline-flex rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 ${focusRing}`}>Request Service</AttributionLink>
    </div></section>

    {activeTestimonials.length ? <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Customer reviews</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">What customers have shared</h2></div><AttributionLink href="/reviews" className="font-bold text-orange-700 hover:underline">View reviews →</AttributionLink></div><div className="mt-9 grid gap-5 md:grid-cols-3">{activeTestimonials.map((item) => <blockquote key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{item.rating ? <div aria-label={`${item.rating} out of 5 stars`} className="text-sm tracking-wider text-orange-500">{"★".repeat(item.rating)}</div> : null}<p className="mt-4 text-lg font-bold leading-8 text-slate-900">“{item.quote}”</p>{item.attribution ? <footer className="mt-5 text-sm text-slate-500">— {item.attribution}</footer> : null}</blockquote>)}</div></section> : null}

    {activeCoupon ? <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8"><div className="grid overflow-hidden rounded-3xl bg-orange-600 text-white shadow-lg md:grid-cols-[1fr_auto] md:items-center"><div className="p-7 sm:p-10"><p className="text-sm font-black uppercase tracking-widest text-orange-100">Current promotion</p><h2 className="mt-3 text-3xl font-black">{activeCoupon.title}</h2><p className="mt-4 max-w-3xl leading-7 text-orange-50">{activeCoupon.body}</p>{activeCoupon.terms ? <p className="mt-5 text-xs leading-5 text-orange-100">{activeCoupon.terms}</p> : null}</div><div className="border-t border-orange-500 p-7 md:border-l md:border-t-0"><AttributionLink href="/appointment" className={`block rounded-xl bg-white px-5 py-3.5 text-center font-black text-orange-700 hover:bg-orange-50 ${focusRing}`}>Request Service</AttributionLink></div></div></section> : null}

    <section className="border-t border-slate-200 bg-white"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_.8fr] lg:px-8">
      <div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Location and contact</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Talk with {shop.name}</h2><p className="mt-4 max-w-xl leading-7 text-slate-600">Call for the quickest conversation, or send a service request with the vehicle details and concern.</p><div className="mt-7 flex flex-wrap gap-3">{shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className={`rounded-xl bg-slate-950 px-5 py-3 font-black text-white hover:bg-slate-800 ${focusRing}`}>Call {shop.phone}</TrackedCallLink> : null}{directionsUrl ? <a href={directionsUrl} target="_blank" rel="noreferrer" className={`rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-800 hover:bg-slate-50 ${focusRing}`}>Get Directions</a> : null}<AttributionLink href="/appointment" className={`rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 ${focusRing}`}>Request Service</AttributionLink></div></div>
      <dl className="rounded-2xl border border-slate-200 bg-stone-50 p-6 sm:p-8"><div><dt className="text-sm font-black uppercase tracking-widest text-slate-500">Address</dt><dd className="mt-2 text-lg font-bold text-slate-950">{address || "Contact the shop for location details"}</dd></div><div className="mt-6 border-t border-slate-200 pt-6"><dt className="text-sm font-black uppercase tracking-widest text-slate-500">Current hours</dt><dd className="mt-2 whitespace-pre-wrap font-semibold leading-7 text-slate-800">{shop.hours}</dd></div></dl>
    </div></section>
  </>;
}
