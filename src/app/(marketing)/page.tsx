import { serviceRequestCopy } from "@/lib/marketing-requested-services";
import type { Metadata } from "next";
import Image from "next/image";
import { AttributionLink } from "@/components/marketing/attribution-link";
import { OwnerPortrait } from "@/components/marketing/owner-portrait";
import { ReviewPlatformIcon } from "@/components/marketing/review-platform-icon";
import { TrackedCallLink } from "@/components/marketing/tracked-call-link";
import { WarrantyTrustSection } from "@/components/marketing/warranty-trust-section";
import { getPublicShop, phoneHref, shopAddress } from "@/lib/marketing";
import { carDocReviewPreviewEnabled, getReviewLinks } from "@/lib/marketing-review-links";
import { getMarketingAboutOwner, getMarketingCoupons, getMarketingMedia, getMarketingServices, getMarketingSettings, getMarketingTestimonials } from "@/lib/marketing-content";
import { autoRepairJsonLd, getPublicSeoShop, localTitle, marketingMetadata, safeJsonLd } from "@/lib/marketing-seo";

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getPublicSeoShop();
  return marketingMetadata({ title: localTitle("Auto Repair", shop), description: `Auto repair, maintenance, diagnostics, brake service and more in ${shop.city ?? "the local area"}${shop.state ? `, ${shop.state}` : ""}. Contact ${shop.name} to request service or speak with the shop.`, path: "/", siteName: shop.name });
}

const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30 focus-visible:ring-offset-2";

export default async function MarketingHome() {
  const [shop, seoShop, settings, owner, services, coupons, testimonials, media] = await Promise.all([
    getPublicShop(), getPublicSeoShop(), getMarketingSettings(), getMarketingAboutOwner(), getMarketingServices(), getMarketingCoupons(), getMarketingTestimonials(), getMarketingMedia(),
  ]);
  const reviewLinks = getReviewLinks(shop, settings.reviewUrl);
  const address = shopAddress(shop);
  const directionsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const featuredServices = services.filter((service) => service.name.trim() && service.summary.trim()).slice(0, 6);
  const activeTestimonials = testimonials.filter((item) => !item.id.startsWith("fallback-") && item.quote.trim()).slice(0, 3);
  const activeCoupon = coupons.find((item) => !item.id.startsWith("fallback-") && item.title.trim() && item.body.trim());
  const primaryMedia = media.find((item) => item.slot === "home-primary");
  const secondaryMedia = media.find((item) => item.slot === "home-secondary");
  const jsonLd = autoRepairJsonLd(seoShop);
  const locality = [seoShop.city, seoShop.state].filter(Boolean).join(", ");

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    <section className="overflow-hidden bg-slate-950 text-white">
      <div className="mx-auto grid max-w-7xl lg:min-h-[620px] lg:grid-cols-[1.05fr_.95fr]">
        <div className="flex items-center px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-orange-400">Vehicle service starts with a conversation</p>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{locality ? `Auto Repair in ${locality}` : "Auto Repair"}</h1>
            <p className="mt-5 text-xl font-bold leading-8 text-white">{settings.headline}</p>
            <p className="mt-4 max-w-xl text-lg leading-8 text-slate-300">{shop.name} offers vehicle maintenance, diagnostics, and repair. Call to discuss your vehicle, or start an online service request.</p>
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
        <div className="relative min-h-80 overflow-hidden border-t border-slate-800 bg-slate-900 lg:min-h-full lg:border-l lg:border-t-0"><div className="absolute inset-x-4 top-7 z-10 sm:inset-x-8 sm:top-10"><AttributionLink href="/reviews" className={`group inline-flex max-w-full items-center gap-3 rounded-2xl border border-white/20 bg-slate-950/80 px-4 py-3 text-white shadow-lg backdrop-blur-sm transition hover:border-orange-400 hover:bg-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/40 ${focusRing}`}><span aria-hidden="true" className="text-3xl leading-none text-amber-400">★</span><span className="min-w-0"><span className="block text-xs font-bold uppercase tracking-wider text-slate-300">Customer feedback</span><span className="block text-base font-black underline decoration-orange-400 underline-offset-4 group-hover:text-orange-300">Read Customer Reviews →</span></span></AttributionLink></div><div className="absolute inset-0 [background-image:linear-gradient(135deg,transparent_0%,transparent_44%,rgb(249_115_22_/_0.18)_44%,rgb(249_115_22_/_0.18)_56%,transparent_56%),radial-gradient(circle_at_68%_32%,rgb(51_65_85)_0%,transparent_42%)]" /><div className="absolute inset-x-8 bottom-8 rounded-2xl border border-white/10 bg-slate-950/70 p-6 backdrop-blur-sm sm:inset-x-12 sm:bottom-12"><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Start a conversation</p><p className="mt-3 max-w-md text-xl font-bold leading-8 text-white">{serviceRequestCopy}</p></div></div>
      </div>
    </section>

    <section aria-label="Why drivers choose this shop" className="border-b border-slate-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 sm:grid-cols-3 sm:gap-5 sm:px-6 lg:px-8">
        {owner?.role ? <div className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 text-xl text-orange-700">✓</span><div><p className="font-black text-slate-950">{owner.role}</p><p className="text-sm text-slate-600">Meet {owner.name} and learn about the shop.</p><AttributionLink href="/about" className={`mt-1 inline-block text-sm font-bold text-orange-700 hover:underline ${focusRing}`}>About the owner →</AttributionLink></div></div> : null}
        <div className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 text-xl text-orange-700">✓</span><div><p className="font-black text-slate-950">Visit us on Mound Road</p><p className="text-sm text-slate-600">{address || "Contact the shop for directions"}</p>{directionsUrl ? <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-block text-sm font-bold text-orange-700 hover:underline ${focusRing}`}>Get directions ↗</a> : null}</div></div>
        <div className="flex items-start gap-3"><span aria-hidden="true" className="mt-0.5 text-xl text-orange-700">✓</span><div><p className="font-black text-slate-950">Understand your options</p><p className="text-sm text-slate-600">Discuss findings and an estimate before choosing what work to authorize.</p><AttributionLink href="/appointment" className={`mt-1 inline-block text-sm font-bold text-orange-700 hover:underline ${focusRing}`}>Start a service request →</AttributionLink></div></div>
      </div>
    </section>

    <WarrantyTrustSection />

    {reviewLinks.google || reviewLinks.facebook ? <section aria-labelledby="customer-voices-title" className="border-y border-slate-200 bg-slate-950 text-white">
      <div className="mx-auto grid max-w-7xl gap-9 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[.85fr_1.15fr] lg:items-center lg:gap-14 lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-400">Customer experiences</p>
          <h2 id="customer-voices-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">What drivers say about {carDocReviewPreviewEnabled(shop) ? "Car Doc" : seoShop.name}</h2>
          {carDocReviewPreviewEnabled(shop) ? <p className="mt-3 text-xs font-bold text-amber-300">Development preview: links to Car Doc&apos;s real public review profiles</p> : null}
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-300">Customer feedback matters when choosing a repair shop. Explore independent reviews and recommendations from drivers who have visited us.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <AttributionLink href="/appointment" className={`rounded-xl bg-orange-500 px-5 py-3.5 text-center font-black text-slate-950 transition hover:bg-orange-400 ${focusRing}`}>Request Service</AttributionLink>
            <AttributionLink href="/reviews" className={`rounded-xl border border-slate-500 px-5 py-3.5 text-center font-bold text-white transition hover:border-white hover:bg-white/10 ${focusRing}`}>View All Review Options</AttributionLink>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-400">Submitting a request does not confirm an appointment. Our team will follow up.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {reviewLinks.google ? <article className="flex flex-col rounded-2xl border border-white/15 bg-white p-6 text-slate-950 shadow-lg">
            <ReviewPlatformIcon platform="google" size={32} />
            <h3 className="mt-4 text-xl font-black">Google Reviews</h3>
            <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">Read customer ratings and feedback directly on Car Doc&apos;s Google listing.</p>
            <a href={reviewLinks.google} target="_blank" rel="noopener noreferrer" className={`mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white hover:bg-slate-800 ${focusRing}`}>Read Google Reviews ↗</a>
          </article> : null}
          {reviewLinks.facebook ? <article className="flex flex-col rounded-2xl border border-white/15 bg-white p-6 text-slate-950 shadow-lg">
            <ReviewPlatformIcon platform="facebook" size={32} />
            <h3 className="mt-4 text-xl font-black">Facebook Recommendations</h3>
            <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">See customer recommendations and posts on Car Doc&apos;s Facebook page.</p>
            <a href={reviewLinks.facebook} target="_blank" rel="noopener noreferrer" className={`mt-6 inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-bold text-slate-950 hover:border-orange-500 ${focusRing}`}>View Facebook Recommendations ↗</a>
          </article> : null}
          <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm leading-6 text-slate-200 sm:col-span-2">
            Already visited? <AttributionLink href="/reviews" className={`font-bold text-orange-300 underline underline-offset-4 hover:text-white ${focusRing}`}>See how to leave feedback →</AttributionLink>
          </div>
        </div>
      </div>
    </section> : null}

    {primaryMedia ? <section className="bg-white"><div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8"><div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-slate-100 shadow-sm"><Image src={primaryMedia.imageUrl} alt={primaryMedia.alt} fill sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" style={{ objectPosition: primaryMedia.objectPosition ?? "center" }} /></div><div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Inside the business</p>{primaryMedia.heading ? <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{primaryMedia.heading}</h2> : null}{primaryMedia.body ? <p className="mt-5 text-lg leading-8 text-slate-600">{primaryMedia.body}</p> : null}</div></div></section> : null}

    {featuredServices.length ? <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="max-w-3xl"><p className="text-sm font-black uppercase tracking-widest text-orange-700">Core services</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{locality ? `Auto Repair Services in ${locality}` : "Auto Repair Services"}</h2><p className="mt-4 text-lg leading-8 text-slate-600">{serviceRequestCopy}</p></div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{featuredServices.map((service, index) => <AttributionLink key={service.slug} href={`/services/${service.slug}`} className={`group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-orange-300 hover:shadow-md ${focusRing}`}><span className="text-sm font-black text-orange-700">{String(index + 1).padStart(2, "0")}</span><h3 className="mt-4 text-xl font-black text-slate-950 group-hover:text-orange-700">{service.name}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{service.summary}</p><span className="mt-5 inline-block text-sm font-bold text-orange-700">Service details →</span></AttributionLink>)}</div>
      <AttributionLink href="/services" className={`mt-8 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 ${focusRing}`}>View all services</AttributionLink>
    </section> : null}

    <section className="bg-white"><div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[.9fr_1.1fr] lg:px-8">
      <div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Why choose this shop</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{settings.aboutTitle}</h2><p className="mt-5 whitespace-pre-wrap text-base leading-7 text-slate-600">{settings.aboutBody}</p>{owner ? <article className="mt-8 flex max-w-xl items-center gap-5 rounded-2xl border border-slate-200 bg-stone-50 p-4 sm:p-5"><OwnerPortrait name={owner.name} imageUrl={owner.imageUrl} imageAlt={owner.imageAlt} compact /><div className="min-w-0"><p className="text-lg font-black text-slate-950">{owner.name}</p><p className="mt-1 text-sm font-bold text-orange-700">{owner.role}</p>{owner.historyLabel ? <p className="mt-2 text-sm leading-6 text-slate-600">{owner.historyLabel}</p> : null}<AttributionLink href="/about" className={`mt-3 inline-flex text-sm font-black text-orange-700 hover:underline ${focusRing}`}>Meet the owner →</AttributionLink></div></article> : null}</div>
      <div className="grid gap-4">
        {owner?.homepageSummary ? <p className="rounded-2xl border border-slate-200 bg-stone-50 p-5 leading-7 text-slate-700">{owner.homepageSummary}</p> : null}
        {(owner?.principles.length ? owner.principles : ["Discuss the concern and review the shop’s recommendation before deciding how to proceed."]).map((body, index) => <article key={body} className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-black text-slate-950">{["Start with the concern", "Explain the findings", "Customer approval before work"][index] ?? "Clear next steps"}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></article>)}
      </div>
    </div></section>

    {secondaryMedia ? <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8"><figure className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="relative aspect-[16/7]"><Image src={secondaryMedia.imageUrl} alt={secondaryMedia.alt} fill sizes="(min-width: 1280px) 1152px, 100vw" className="object-cover" style={{ objectPosition: secondaryMedia.objectPosition ?? "center" }} /></div>{secondaryMedia.heading || secondaryMedia.body ? <figcaption className="p-6 sm:p-8">{secondaryMedia.heading ? <h2 className="text-2xl font-black">{secondaryMedia.heading}</h2> : null}{secondaryMedia.body ? <p className="mt-3 leading-7 text-slate-600">{secondaryMedia.body}</p> : null}</figcaption> : null}</figure></section> : null}

    <section className="border-y border-slate-200 bg-stone-100"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="max-w-3xl"><p className="text-sm font-black uppercase tracking-widest text-orange-700">How requesting service works</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">A request starts the conversation</h2><p className="mt-4 text-slate-600">Your request is not an automatically confirmed appointment. The shop will contact you before timing is finalized.</p></div>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[["1", "Start a conversation", "Select a service category and preferred contact method. The shop will contact you to get the details."], ["2", "Evaluate the vehicle", `${shop.name} inspects or tests the vehicle as appropriate to the concern.`], ["3", "Review the findings", "The shop explains what it found in understandable terms."], ["4", "Discuss the options", "Review the practical recommendation, priorities, and estimate."], ["5", "Approve the work", "Repair work proceeds after you decide what to authorize."]].map(([number, title, body]) => <li key={number} className="rounded-2xl bg-white p-5 shadow-sm"><span className="flex size-9 items-center justify-center rounded-full bg-orange-100 font-black text-orange-800">{number}</span><h3 className="mt-5 text-lg font-black">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p></li>)}</ol>
      <AttributionLink href="/appointment" className={`mt-8 inline-flex rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 ${focusRing}`}>Request Service</AttributionLink>
    </div></section>

    {activeTestimonials.length ? <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Customer reviews</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">What customers have shared</h2></div><AttributionLink href="/reviews" className="font-bold text-orange-700 hover:underline">View reviews →</AttributionLink></div><div className="mt-9 grid gap-5 md:grid-cols-3">{activeTestimonials.map((item) => <blockquote key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{item.rating ? <div aria-label={`${item.rating} out of 5 stars`} className="text-sm tracking-wider text-orange-500">{"★".repeat(item.rating)}</div> : null}<p className="mt-4 text-lg font-bold leading-8 text-slate-900">“{item.quote}”</p>{item.attribution ? <footer className="mt-5 text-sm text-slate-500">— {item.attribution}</footer> : null}</blockquote>)}</div></section> : null}

    {activeCoupon ? <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8"><div className="grid overflow-hidden rounded-3xl bg-orange-600 text-white shadow-lg md:grid-cols-[1fr_auto] md:items-center"><div className="p-7 sm:p-10"><p className="text-sm font-black uppercase tracking-widest text-orange-100">Current promotion</p><h2 className="mt-3 text-3xl font-black">{activeCoupon.title}</h2><p className="mt-4 max-w-3xl leading-7 text-orange-50">{activeCoupon.body}</p>{activeCoupon.terms ? <p className="mt-5 text-xs leading-5 text-orange-100">{activeCoupon.terms}</p> : null}</div><div className="border-t border-orange-500 p-7 md:border-l md:border-t-0"><AttributionLink href="/appointment" className={`block rounded-xl bg-white px-5 py-3.5 text-center font-black text-orange-700 hover:bg-orange-50 ${focusRing}`}>Request Service</AttributionLink></div></div></section> : null}

    <section className="border-t border-slate-200 bg-white"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_.8fr] lg:px-8">
      <div><p className="text-sm font-black uppercase tracking-widest text-orange-700">Location and contact</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{locality ? `Serving ${locality} and nearby communities` : `Talk with ${shop.name}`}</h2><p className="mt-4 max-w-xl leading-7 text-slate-600">{address ? `${shop.name} is located at ${address}. ` : ""}Call for the quickest conversation, or select a service category and preferred contact method online. The shop will contact you to get the details.</p><div className="mt-7 flex flex-wrap gap-3">{shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className={`rounded-xl bg-slate-950 px-5 py-3 font-black text-white hover:bg-slate-800 ${focusRing}`}>Call {shop.phone}</TrackedCallLink> : null}{directionsUrl ? <a href={directionsUrl} target="_blank" rel="noreferrer" className={`rounded-xl border border-slate-300 bg-white px-5 py-3 font-black text-slate-800 hover:bg-slate-50 ${focusRing}`}>Get Directions</a> : null}<AttributionLink href="/appointment" className={`rounded-xl bg-orange-600 px-5 py-3 font-black text-white hover:bg-orange-700 ${focusRing}`}>Request Service</AttributionLink></div></div>
      <dl className="rounded-2xl border border-slate-200 bg-stone-50 p-6 sm:p-8"><div><dt className="text-sm font-black uppercase tracking-widest text-slate-500">Address</dt><dd className="mt-2 text-lg font-bold text-slate-950">{address || "Contact the shop for location details"}</dd></div><div className="mt-6 border-t border-slate-200 pt-6"><dt className="text-sm font-black uppercase tracking-widest text-slate-500">Current hours</dt><dd className="mt-2 whitespace-pre-wrap font-semibold leading-7 text-slate-800">{shop.hours}</dd></div></dl>
    </div></section>
    {shop.phone ? <><div className="h-20 sm:hidden" aria-hidden="true" /><nav aria-label="Quick service actions" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 gap-3 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-6px_20px_rgba(15,23,42,.12)] backdrop-blur sm:hidden"><TrackedCallLink href={phoneHref(shop.phone)} className={`flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-3 text-center text-sm font-black text-slate-950 ${focusRing}`}>Call {shop.phone}</TrackedCallLink><AttributionLink href="/appointment" className={`flex min-h-12 items-center justify-center rounded-xl bg-orange-600 px-3 text-center text-sm font-black text-white ${focusRing}`}>Request Service</AttributionLink></nav></> : null}
  </>;
}
