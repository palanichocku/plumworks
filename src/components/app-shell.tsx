import Link from "next/link";
import { DesktopNavigation, MobileNavigation } from "./app-navigation";
import { signOut } from "@/app/(app)/actions";

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail: string;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white print:hidden lg:hidden">
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight">
            Car Doc
          </Link>
          <form action={signOut}>
            <button
              type="submit"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Sign out
            </button>
          </form>
        </div>
        <MobileNavigation />
      </header>

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white p-5 print:hidden lg:flex lg:flex-col">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-sm font-bold text-white">
            CD
          </span>
          <span>
            <span className="block text-lg font-bold tracking-tight">Car Doc</span>
            <span className="block text-xs text-slate-500">Shop workspace</span>
          </span>
        </Link>

        <DesktopNavigation />

        <div className="mt-auto border-t border-slate-200 pt-5">
          <p className="truncate text-sm font-medium text-slate-900">
            {userEmail}
          </p>
          <p className="mt-1 text-xs text-slate-500">Signed in</p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-4 text-sm font-medium text-slate-600 hover:text-slate-950"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="print:pl-0 lg:pl-64">
        <div className="mx-auto max-w-7xl px-5 py-8 print:max-w-none print:p-0 sm:px-8 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
