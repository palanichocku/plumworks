"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Website", shortLabel: "W" },
  { href: "/dashboard", label: "Dashboard", shortLabel: "D" },
  { href: "/customers", label: "Customers", shortLabel: "C" },
  { href: "/vehicles", label: "Vehicles", shortLabel: "V" },
  { href: "/invoices", label: "Invoices", shortLabel: "I" },
  { href: "/accounts-receivable", label: "Accounts Receivable", shortLabel: "A" },
  { href: "/repair-orders", label: "Repair Orders", shortLabel: "R" },
  { href: "/reports", label: "Reports", shortLabel: "P" },
  { href: "/help", label: "Help", shortLabel: "H" },
  { href: "/admin", label: "Admin", shortLabel: "A" },
];

function NavigationLink({
  href,
  label,
  shortLabel,
  mobile = false,
}: {
  href: string;
  label: string;
  shortLabel: string;
  mobile?: boolean;
}) {
  const pathname = usePathname();
  const isActive =
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/repair-orders" && pathname.startsWith("/open-orders/"));

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        mobile
          ? `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-brand-subtle text-brand-primary"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`
          : `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? "bg-brand-subtle text-brand-primary"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`
      }
    >
      {!mobile && (
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${
            isActive
              ? "bg-brand-primary text-white"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {shortLabel}
        </span>
      )}
      {label}
    </Link>
  );
}

function allowedNavigation(canViewReports: boolean, canViewAdmin: boolean) {
  return navigation.filter((item) => (item.href !== "/reports" || canViewReports) && (!["/", "/admin"].includes(item.href) || canViewAdmin));
}

export function DesktopNavigation({ canViewReports, canViewAdmin }: { canViewReports: boolean; canViewAdmin: boolean }) {
  return (
    <nav className="-mr-2 mt-8 min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-2" aria-label="Primary navigation">
      {allowedNavigation(canViewReports, canViewAdmin).map((item) => (
        <NavigationLink key={item.href} {...item} />
      ))}
    </nav>
  );
}

export function MobileNavigation({ canViewReports, canViewAdmin }: { canViewReports: boolean; canViewAdmin: boolean }) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2"
      aria-label="Mobile navigation"
    >
      {allowedNavigation(canViewReports, canViewAdmin).map((item) => (
        <NavigationLink key={item.href} {...item} mobile />
      ))}
    </nav>
  );
}
