import type { Metadata } from "next";
import { EmptyMarketingCollection } from "@/components/marketing/empty-marketing-collection";
import { MarketingPageHero } from "@/components/marketing/page-hero";
import { getPublicShop } from "@/lib/marketing";
import { getMarketingGallery, getMarketingPage } from "@/lib/marketing-content";

function approvedPhotos<T extends { id: string; imageUrl: string | null }>(items: T[]) { return items.filter((item) => !item.id.startsWith("fallback-") && item.imageUrl?.startsWith("https://")); }

export async function generateMetadata(): Promise<Metadata> {
  const hasPhotos = approvedPhotos(await getMarketingGallery()).length > 0;
  return { title: "Shop Photos", description: "Approved repair shop, team, and facility photos.", robots: hasPhotos ? undefined : { index: false, follow: true } };
}

export default async function PhotosPage() {
  const [page, loadedItems, shop] = await Promise.all([getMarketingPage("photos"), getMarketingGallery(), getPublicShop()]);
  const items = approvedPhotos(loadedItems);
  return <>
    <MarketingPageHero eyebrow={page.eyebrow ?? "Gallery"} title={page.title} description={page.description} />
    {items.length ? <>
      {page.body ? <p className="mx-auto max-w-3xl px-4 pt-12 text-center leading-7 text-slate-600 sm:px-6">{page.body}</p> : null}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">{items.map((item) => <div key={item.id} role="img" aria-label={item.title} className="relative flex min-h-64 items-end overflow-hidden rounded-3xl bg-slate-950 bg-cover bg-center p-6 text-white" style={{ backgroundImage: `linear-gradient(transparent, rgb(2 6 23 / .85)), url(${JSON.stringify(item.imageUrl)})` }}><div><p className="text-xs font-black uppercase tracking-widest text-orange-400">Shop photo</p><p className="mt-2 text-xl font-black">{item.title}</p>{item.caption ? <p className="mt-2 text-sm text-slate-200">{item.caption}</p> : null}</div></div>)}</section>
    </> : <EmptyMarketingCollection shop={shop} message={page.body || "Approved current shop photographs have not been published yet."} />}
  </>;
}
