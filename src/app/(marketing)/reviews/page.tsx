import type { Metadata } from "next";
import { EmptyMarketingCollection } from "@/components/marketing/empty-marketing-collection";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingPage, getMarketingSettings, getMarketingTestimonials } from "@/lib/marketing-content";
import { getPublicSeoShop, localTitle, marketingMetadata } from "@/lib/marketing-seo";

function approvedTestimonials<T extends { id: string }>(items: T[]) { return items.filter((item) => !item.id.startsWith("fallback-")); }

export async function generateMetadata(): Promise<Metadata> {
  const [testimonials, shop] = await Promise.all([getMarketingTestimonials(), getPublicSeoShop()]); const hasTestimonials = approvedTestimonials(testimonials).length > 0;
  return marketingMetadata({ title: localTitle("Customer Reviews", shop), description: `Read approved customer feedback about ${shop.name}.`, path: "/reviews", siteName: shop.name, index: hasTestimonials });
}

export default async function ReviewsPage() {
  const [page, settings, loadedTestimonials, shop] = await Promise.all([getMarketingPage("reviews"), getMarketingSettings(), getMarketingTestimonials(), getPublicShop()]);
  const testimonials = approvedTestimonials(loadedTestimonials);
  const configured = settings.reviewUrl || process.env.PLUMWORKS_GOOGLE_REVIEW_URL?.trim();
  const reviewUrl = configured?.startsWith("https://") ? configured : null;
  return <>
    <MarketingPageHero eyebrow={page.eyebrow ?? "Reviews"} title={page.title} description={page.description} />
    {testimonials.length ? <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      {page.body ? <p className="mx-auto mb-10 max-w-3xl text-center leading-7 text-slate-600">{page.body}</p> : null}
      <div className="grid gap-5 md:grid-cols-3">{testimonials.map((item) => <blockquote key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6">{item.rating ? <div aria-label={`${item.rating} out of 5 stars`} className="text-orange-500">{"★".repeat(item.rating)}</div> : null}<p className="mt-4 font-bold">“{item.quote}”</p>{item.attribution ? <footer className="mt-4 text-xs text-slate-500">{item.attribution}</footer> : null}</blockquote>)}</div>
      {reviewUrl ? <div className="mt-10 rounded-3xl bg-slate-950 p-8 text-center text-white"><h2 className="text-2xl font-black">Already visited?</h2><p className="mt-3 text-slate-300">Share your experience through the shop’s configured review page.</p><a href={reviewUrl} className="mt-6 inline-block rounded-xl bg-orange-600 px-5 py-3 font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Leave a review</a></div> : null}
    </section> : <EmptyMarketingCollection shop={shop} message={page.body || "Verified customer feedback has not been published yet. Contact the shop directly to discuss your vehicle."} />}
  </>;
}
