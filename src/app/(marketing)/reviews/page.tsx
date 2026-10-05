import type { Metadata } from "next";
import { EmptyMarketingCollection } from "@/components/marketing/empty-marketing-collection";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { ReviewPlatformIcon } from "@/components/marketing/review-platform-icon";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingPage, getMarketingSettings, getMarketingTestimonials } from "@/lib/marketing-content";
import { getPublicSeoShop, localTitle, marketingMetadata } from "@/lib/marketing-seo";
import { getReviewLinks } from "@/lib/marketing-review-links";

function approvedTestimonials<T extends { id: string }>(items: T[]) { return items.filter((item) => !item.id.startsWith("fallback-")); }

export async function generateMetadata(): Promise<Metadata> {
  const [testimonials, shop, settings] = await Promise.all([getMarketingTestimonials(), getPublicSeoShop(), getMarketingSettings()]);
  const links = getReviewLinks(shop, settings.reviewUrl);
  const hasProfiles = Boolean(links.google || links.facebook);
  const hasReviews = approvedTestimonials(testimonials).length > 0 || hasProfiles;
  return marketingMetadata({ title: localTitle("Customer Reviews", shop), description: hasProfiles ? `Find customer feedback about ${shop.name} on Google and Facebook.` : `Read approved customer feedback about ${shop.name}.`, path: "/reviews", siteName: shop.name, index: hasReviews });
}

export default async function ReviewsPage() {
  const [page, settings, loadedTestimonials, shop] = await Promise.all([getMarketingPage("reviews"), getMarketingSettings(), getMarketingTestimonials(), getPublicShop()]);
  const testimonials = approvedTestimonials(loadedTestimonials);
  const links = getReviewLinks(shop, settings.reviewUrl);
  const hasProfiles = Boolean(links.google || links.facebook);
  return <>
    <MarketingPageHero eyebrow={page.eyebrow ?? "Reviews"} title={page.title} description={hasProfiles ? "See customer feedback on Google and Facebook, and share your own experience." : page.description} />
    {hasProfiles ? <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <div className="grid gap-5 sm:grid-cols-2">
        {links.google ? <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><ReviewPlatformIcon platform="google" size={30} /><h2 className="mt-4 text-2xl font-black">Google Reviews</h2><p className="mt-3 leading-7 text-slate-600">Read reviews from customers on {shop.name}&apos;s Google Business Profile.</p><a href={links.google} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 font-bold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Read Google Reviews ↗</a></article> : null}
        {links.facebook ? <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><ReviewPlatformIcon platform="facebook" size={30} /><h2 className="mt-4 text-2xl font-black">Facebook Recommendations</h2><p className="mt-3 leading-7 text-slate-600">Visit {shop.name}&apos;s Facebook page for recommendations and customer posts.</p><a href={links.facebook} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">Visit Facebook Page ↗</a></article> : null}
      </div>
      {links.leaveGoogle ? <div className="mt-8 rounded-2xl bg-orange-50 p-6 sm:flex sm:items-center sm:justify-between sm:gap-6"><div><h2 className="text-xl font-black">Already visited?</h2><p className="mt-2 text-sm leading-6 text-slate-700">Share your own experience on Google. A Google sign-in may be required.</p></div><a href={links.leaveGoogle} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block shrink-0 rounded-xl bg-orange-600 px-5 py-3 text-center font-black text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30 sm:mt-0">Leave a Google Review ↗</a></div> : null}
    </section> : null}
    {testimonials.length ? <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <h2 className="mb-7 text-2xl font-black">Selected customer feedback</h2>
      <div className="grid gap-5 md:grid-cols-3">{testimonials.map((item) => <blockquote key={item.id} className="rounded-2xl border border-slate-200 bg-white p-6">{item.rating ? <div aria-label={`${item.rating} out of 5 stars`} className="text-orange-500">{"★".repeat(item.rating)}</div> : null}<p className="mt-4 font-bold">“{item.quote}”</p>{item.attribution ? <footer className="mt-4 text-xs text-slate-500">{item.attribution}</footer> : null}</blockquote>)}</div>
    </section> : !hasProfiles ? <EmptyMarketingCollection shop={shop} message={page.body || "Verified customer feedback has not been published yet. Contact the shop directly to discuss your vehicle."} /> : null}
  </>;
}
