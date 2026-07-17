import Link from "next/link";
import { poweredByText } from "@/lib/branding";
import { phoneHref, shopAddress, type PublicShop } from "@/lib/marketing";

const links = [
  ["Services", "/services"], ["Coupons", "/coupons"], ["Reviews", "/reviews"],
  ["About", "/about"], ["Photos", "/photos"], ["Contact", "/contact"],
] as const;

export function MarketingShell({ shop, children }: { shop: PublicShop; children: React.ReactNode }) {
  const address = shopAddress(shop);
  return <div className="min-h-screen bg-stone-50 text-slate-950">
    <div className="bg-slate-950 px-4 py-2 text-center text-xs font-semibold text-slate-200">
      <span>{shop.hours}</span>{shop.phone && <><span className="mx-2 text-slate-600">•</span><a href={phoneHref(shop.phone)} className="hover:text-white">{shop.phone}</a></>}
    </div>
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-lg font-black text-white">{shop.name.charAt(0)}</span>
          <span className="max-w-44 truncate text-base font-black tracking-tight sm:max-w-none sm:text-lg">{shop.name}</span>
        </Link>
        <nav aria-label="Public navigation" className="hidden items-center gap-5 lg:flex">
          {links.map(([label, href]) => <Link key={href} href={href} className="text-sm font-semibold text-slate-600 hover:text-orange-600">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden text-sm font-semibold text-slate-500 hover:text-slate-950 sm:block">Staff Login</Link>
          <Link href="/appointment" className="rounded-xl bg-orange-500 px-3.5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-600">Schedule</Link>
        </div>
      </div>
      <nav aria-label="Mobile public navigation" className="flex gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2.5 lg:hidden">
        {links.map(([label, href]) => <Link key={href} href={href} className="whitespace-nowrap text-xs font-bold text-slate-600">{label}</Link>)}
      </nav>
    </header>
    <main>{children}</main>
    <footer className="bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
        <div><p className="text-xl font-black text-white">{shop.name}</p><p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">Straightforward vehicle care, clear communication, and a local team ready to help.</p></div>
        <div><p className="text-sm font-bold uppercase tracking-widest text-slate-500">Visit</p><p className="mt-3 text-sm leading-6">{address || "Contact us for location details"}<br />{shop.hours}</p></div>
        <div className="md:text-right"><div className="flex flex-wrap gap-2 md:justify-end"><Link href="/appointment" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white">Schedule Appointment</Link><Link href="/drop-off" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-white">Request Drop-Off</Link></div><p className="mt-6 text-xs text-slate-500">{poweredByText}</p></div>
      </div>
    </footer>
  </div>;
}
