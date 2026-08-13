import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttributionLink } from "@/components/marketing/attribution-link";
import { TrackedCallLink } from "@/components/marketing/tracked-call-link";
import { getMarketingServices } from "@/lib/marketing-content";
import { phoneHref } from "@/lib/marketing";
import { marketingServices } from "@/lib/marketing-services";
import { canonicalUrl, getPublicSeoShop, localTitle, marketingMetadata, safeJsonLd, serviceSeoTitle } from "@/lib/marketing-seo";
import type { ServiceContent } from "@/lib/marketing-service-content";

const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30";

export function generateStaticParams() { return marketingServices.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await params).slug;
  const [shop, services] = await Promise.all([getPublicSeoShop(), getMarketingServices()]);
  const service = services.find((item) => item.slug === slug);
  return service ? marketingMetadata({ title: localTitle(serviceSeoTitle(slug, service.name), shop), description: `${service.summary} Contact ${shop.name} in ${shop.city ?? "the local area"} to discuss your vehicle and request service.`, path: `/services/${slug}`, siteName: shop.name }) : {};
}

export default async function ServiceDetail({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const [services, shop] = await Promise.all([getMarketingServices(), getPublicSeoShop()]);
  const service = services.find((item) => item.slug === slug);
  if (!service) notFound();
  const serviceUrl = canonicalUrl(`/services/${slug}`);
  const serviceJsonLd = serviceUrl ? [
    { "@context": "https://schema.org", "@type": "Service", name: service.name, description: service.content?.intro ?? service.summary, url: serviceUrl.href, provider: { "@id": `${serviceUrl.origin}/#business`, name: shop.name } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${serviceUrl.origin}/` }, { "@type": "ListItem", position: 2, name: "Services", item: `${serviceUrl.origin}/services` }, { "@type": "ListItem", position: 3, name: service.name, item: serviceUrl.href }] },
  ] : [];
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(serviceJsonLd) }} />
    {service.content ? <StructuredServicePage service={service} content={service.content} shop={shop} /> : <LegacyServicePage service={service} />}
  </>;
}

function StructuredServicePage({ service, content, shop }: { service: { slug: string; name: string }; content: ServiceContent; shop: { name: string; city: string | null; phone: string | null } }) {
  return <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
    <AttributionLink href="/services" className={`text-sm font-bold text-orange-700 hover:underline ${focusRing}`}>← All services</AttributionLink>
    <header className="mt-8 max-w-4xl">
      <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-700">Vehicle service{shop.city ? ` in ${shop.city}` : ""}</p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{content.heading}</h1>
      <p className="mt-6 text-lg leading-8 text-slate-600 sm:text-xl sm:leading-9">{content.intro}</p>
    </header>

    <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-14">
        <ListSection section={content.signs} />
        <ListSection section={content.services} />
        <section aria-labelledby="helpful-information"><h2 id="helpful-information" className="text-2xl font-black text-slate-950 sm:text-3xl">{content.helpful.heading}</h2><div className="mt-5 space-y-4 text-base leading-8 text-slate-600">{content.helpful.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>
        <section aria-labelledby="what-to-expect"><h2 id="what-to-expect" className="text-2xl font-black text-slate-950 sm:text-3xl">{content.expectations.heading}</h2><p className="mt-5 leading-8 text-slate-600">{content.expectations.intro}</p><ol className="mt-6 grid gap-4 sm:grid-cols-2">{content.expectations.items.map((item, index) => <li key={item} className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm"><span className="mb-3 block text-xs font-black text-orange-700">{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol></section>
        <section aria-labelledby="common-questions"><h2 id="common-questions" className="text-2xl font-black text-slate-950 sm:text-3xl">Common questions</h2><div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">{content.faqs.map((faq) => <article key={faq.question} className="py-6"><h3 className="text-lg font-black text-slate-950">{faq.question}</h3><p className="mt-3 leading-7 text-slate-600">{faq.answer}</p></article>)}</div></section>
        {content.related.length ? <nav aria-label="Related services"><h2 className="text-2xl font-black text-slate-950">Related services</h2><div className="mt-5 flex flex-wrap gap-3">{content.related.map((link) => <AttributionLink key={link.slug} href={`/services/${link.slug}`} className={`rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:border-orange-400 hover:text-orange-700 ${focusRing}`}>{link.label} →</AttributionLink>)}</div></nav> : null}
      </div>

      <aside className="rounded-3xl bg-slate-950 p-7 text-white lg:sticky lg:top-28">
        <p className="text-sm font-black uppercase tracking-widest text-orange-400">Talk with {shop.name}</p>
        <h2 className="mt-4 text-2xl font-black">{content.cta.heading}</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">{content.cta.body}</p>
        <AttributionLink href={`/appointment?service=${service.slug}`} className={`mt-7 block rounded-xl bg-orange-500 px-5 py-3.5 text-center font-black text-slate-950 hover:bg-orange-400 ${focusRing}`}>{content.cta.requestLabel}</AttributionLink>
        {shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className={`mt-3 block rounded-xl border border-slate-700 px-5 py-3.5 text-center font-bold hover:border-slate-500 hover:bg-white/5 ${focusRing}`}>{content.cta.callLabel}</TrackedCallLink> : null}
      </aside>
    </div>
  </main>;
}

function ListSection({ section }: { section: { heading: string; intro?: string; items: string[] } }) {
  return <section><h2 className="text-2xl font-black text-slate-950 sm:text-3xl">{section.heading}</h2>{section.intro ? <p className="mt-5 leading-8 text-slate-600">{section.intro}</p> : null}<ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">{section.items.map((item) => <li key={item} className="flex gap-3 leading-7 text-slate-600"><span aria-hidden="true" className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-orange-500" />{item}</li>)}</ul></section>;
}

function LegacyServicePage({ service }: { service: { slug: string; name: string; detail: string } }) {
  return <main className="mx-auto max-w-5xl px-4 py-20 sm:px-6"><Link href="/services" className="text-sm font-bold text-orange-700">← All services</Link><div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]"><div><p className="text-xs font-black uppercase tracking-[0.25em] text-orange-700">Vehicle service</p><h1 className="mt-4 text-5xl font-black tracking-tight">{service.name}</h1><p className="mt-6 text-xl leading-9 text-slate-600">{service.detail}</p><h2 className="mt-10 text-2xl font-black">What to expect</h2><ul className="mt-5 space-y-3 text-slate-600"><li>A conversation about symptoms, timing, and priorities.</li><li>An inspection or test appropriate to the concern.</li><li>A clear recommendation and estimate before authorized work.</li></ul></div><aside className="rounded-3xl bg-slate-950 p-7 text-white"><p className="text-sm font-black uppercase tracking-widest text-orange-400">Need this service?</p><AttributionLink href={`/appointment?service=${service.slug}`} className="mt-6 block rounded-xl bg-orange-500 px-5 py-3 text-center font-black text-slate-950">Request Service</AttributionLink></aside></div></main>;
}
