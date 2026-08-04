import Link from "next/link";
import { poweredByText } from "@/lib/branding";
import { phoneHref, shopAddress, type PublicShop } from "@/lib/marketing";
import { AttributionLink } from "@/components/marketing/attribution-link";
import { TrackedCallLink } from "@/components/marketing/tracked-call-link";

const primaryLinks = [["Home", "/"], ["Services", "/services"], ["About", "/about"], ["Contact", "/contact"]] as const;

const linkFocus = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/25 focus-visible:ring-offset-2";

export function MarketingShell({ shop, optionalLinks = [], previewMode = false, children }: { shop: PublicShop; optionalLinks?: readonly (readonly [string, string])[]; previewMode?: boolean; children: React.ReactNode }) {
  const address = shopAddress(shop);
  const navigationLinks = [...primaryLinks, ...optionalLinks];
  return <div className="min-h-screen bg-stone-50 text-slate-950">
    {previewMode ? <div role="status" className="bg-amber-300 px-4 py-2 text-center text-xs font-black text-amber-950">Local marketing-content preview — database content is not being used</div> : null}
    <div className="border-b border-slate-800 bg-slate-950 px-4 py-2.5 text-center text-xs font-semibold text-slate-200">
      <span>{shop.hours}</span>{shop.phone ? <><span className="mx-2 text-slate-600">•</span><TrackedCallLink href={phoneHref(shop.phone)} className={`hover:text-white ${linkFocus}`}>{shop.phone}</TrackedCallLink></> : null}
    </div>
    <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <AttributionLink href="/" className={`flex min-w-0 items-center gap-3 rounded-lg ${linkFocus}`}>
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-lg font-black text-white">{shop.name.charAt(0)}</span>
          <span className="truncate text-base font-black tracking-tight sm:text-lg">{shop.name}</span>
        </AttributionLink>
        <nav aria-label="Primary navigation" className="hidden items-center gap-6 lg:flex">
          {primaryLinks.map(([label, href]) => <AttributionLink key={href} href={href} className={`rounded-md text-sm font-semibold text-slate-600 transition hover:text-orange-700 ${linkFocus}`}>{label}</AttributionLink>)}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          {shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className={`rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-bold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 ${linkFocus}`}>Call {shop.phone}</TrackedCallLink> : null}
          <AttributionLink href="/appointment" className={`rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 ${linkFocus}`}>Request Service</AttributionLink>
        </div>
        <details className="group relative lg:hidden">
          <summary className={`cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 [&::-webkit-details-marker]:hidden ${linkFocus}`}>Menu</summary>
          <nav aria-label="Mobile navigation" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {navigationLinks.map(([label, href]) => <AttributionLink key={href} href={href} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-orange-700">{label}</AttributionLink>)}
            <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2">
              <AttributionLink href="/appointment" className="rounded-lg bg-orange-600 px-3 py-2.5 text-center text-sm font-bold text-white">Request Service</AttributionLink>
              {shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className="rounded-lg border border-slate-300 px-3 py-2.5 text-center text-sm font-bold text-slate-800">Call Now</TrackedCallLink> : null}
            </div>
          </nav>
        </details>
      </div>
    </header>
    <main>{children}</main>
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.1fr_.9fr_.9fr] lg:px-8">
        <div><p className="text-xl font-black text-white">{shop.name}</p><p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">Contact the shop to discuss a vehicle concern, maintenance need, or service request.</p>{shop.phone ? <TrackedCallLink href={phoneHref(shop.phone)} className="mt-5 inline-block rounded-md font-bold text-white hover:text-orange-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/30">{shop.phone}</TrackedCallLink> : null}</div>
        <div><p className="text-sm font-bold uppercase tracking-widest text-slate-500">Visit</p><p className="mt-3 text-sm leading-6">{address || "Contact the shop for location details"}</p><p className="mt-3 text-sm leading-6 text-slate-400">{shop.hours}</p></div>
        <div><p className="text-sm font-bold uppercase tracking-widest text-slate-500">Explore</p><nav aria-label="Footer navigation" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{[...primaryLinks.slice(1), ...optionalLinks].map(([label, href]) => <AttributionLink key={href} href={href} className="hover:text-white">{label}</AttributionLink>)}<AttributionLink href="/appointment" className="hover:text-white">Request Service</AttributionLink><AttributionLink href="/privacy" className="hover:text-white">Privacy</AttributionLink><Link href="/login" className="hover:text-white">Staff Login</Link></nav></div>
      </div>
      <div className="border-t border-slate-800 px-4 py-5 text-center text-xs text-slate-500">{poweredByText}</div>
    </footer>
  </div>;
}
