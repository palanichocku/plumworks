import Link from "next/link";
import { DesktopNavigation, MobileNavigation } from "./app-navigation";
import { signOut } from "@/app/(app)/actions";
import { poweredByText } from "@/lib/branding";

export function AppShell({
  children,
  userEmail,
  shopName,
  canViewReports,
  canViewAdmin,
}: {
  children: React.ReactNode;
  userEmail: string;
  shopName: string;
  canViewReports: boolean;
  canViewAdmin: boolean;
}) {
  const shopInitials = shopName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "S";
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white shadow-sm print:hidden lg:hidden">
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-xs font-black text-white shadow-sm">
              {shopInitials}
            </span>
            <span className="text-base font-bold tracking-tight text-slate-900">{shopName}</span>
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </div>
        <MobileNavigation canViewReports={canViewReports} canViewAdmin={canViewAdmin} />
      </header>

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white p-6 print:hidden lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-sm font-black text-white shadow-md shadow-sky-500/20 transition-transform group-hover:scale-[1.02]">
            {shopInitials}
          </span>
          <div>
            <span className="block text-base font-extrabold tracking-tight text-slate-900 leading-tight">{shopName}</span>
            <span className="block text-[11px] font-medium text-slate-400 mt-0.5 tracking-wide uppercase">Shop Workspace</span>
          </div>
        </Link>

        <form action="/search" className="mt-6 relative">
          <label htmlFor="sidebar-shop-search" className="sr-only">Search shop records</label>
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <input 
            id="sidebar-shop-search" 
            name="q" 
            type="search" 
            placeholder="Search records..." 
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-500/5" 
          />
        </form>

        <DesktopNavigation canViewReports={canViewReports} canViewAdmin={canViewAdmin} />

        <div className="mt-auto rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse shrink-0" />
              <p className="truncate text-xs font-semibold text-slate-800" title={userEmail}>
                {userEmail}
              </p>
            </div>
            <form action={signOut} className="shrink-0">
              <button
                type="submit"
                className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
          <p className="mt-3 border-t border-slate-200 pt-3 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">{poweredByText}</p>
        </div>
      </aside>

      <main className="print:pl-0 lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
        <footer className="border-t border-slate-200 px-5 py-4 text-center text-xs text-slate-400 print:hidden lg:hidden">{poweredByText}</footer>
      </main>
    </div>
  );
}
