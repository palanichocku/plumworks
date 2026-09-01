import type { Metadata } from "next";
import Image from "next/image";
import { EmptyMarketingCollection } from "@/components/marketing/empty-marketing-collection";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingGallery, getMarketingPage } from "@/lib/marketing-content";
import { getPublicSeoShop, localTitle, marketingMetadata } from "@/lib/marketing-seo";

function approvedPhotos<T extends { id: string; imageUrl: string | null }>(items: T[]) { return items.filter((item) => !item.id.startsWith("fallback-") && (item.imageUrl?.startsWith("/client-assets/") || item.imageUrl?.startsWith("https://"))); }

export async function generateMetadata(): Promise<Metadata> {
  const [gallery, shop] = await Promise.all([getMarketingGallery(), getPublicSeoShop()]); const hasPhotos = approvedPhotos(gallery).length > 0;
  return marketingMetadata({ title: localTitle("Shop Photos", shop), description: `View approved current shop, team, and facility photos from ${shop.name}.`, path: "/photos", siteName: shop.name, index: hasPhotos });
}

export default async function PhotosPage() {
  const [page, loadedItems, shop] = await Promise.all([getMarketingPage("photos"), getMarketingGallery(), getPublicShop()]);
  const items = approvedPhotos(loadedItems);
  return <>
    <MarketingPageHero eyebrow={page.eyebrow ?? "Gallery"} title={page.title} description={page.description} />
    {items.length ? <>
      {page.body ? <p className="mx-auto max-w-3xl px-4 pt-12 text-center leading-7 text-slate-600 sm:px-6">{page.body}</p> : null}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">{items.map((item) => <figure key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="relative aspect-[4/3] bg-slate-100"><Image src={item.imageUrl!} alt={item.alt || item.title} fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" /></div><figcaption className="p-5"><p className="text-xs font-black uppercase tracking-widest text-orange-700">Shop photo</p><p className="mt-2 text-xl font-black">{item.title}</p>{item.caption ? <p className="mt-2 text-sm leading-6 text-slate-600">{item.caption}</p> : null}</figcaption></figure>)}</section>
    </> : <EmptyMarketingCollection shop={shop} message={page.body || "Approved current shop photographs have not been published yet."} />}
  </>;
}
