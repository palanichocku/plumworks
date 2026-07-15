"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "D" },
  { href: "/customers", label: "Customers", shortLabel: "C" },
  { href: "/vehicles", label: "Vehicles", shortLabel: "V" },
  { href: "/invoices", label: "Invoices", shortLabel: "I" },
  { href: "/accounts-receivable", label: "Accounts Receivable", shortLabel: "A" },
  { href: "/repair-orders", label: "Repair Orders", shortLabel: "R" },
  { href: "/reports", label: "Reports", shortLabel: "P" },
  { href: "/settings", label: "Settings", shortLabel: "S" },
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
                ? "bg-sky-50 text-sky-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`
          : `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              isActive
                ? "bg-sky-50 text-sky-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`
      }
    >
      {!mobile && (
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${
            isActive
              ? "bg-sky-600 text-white"
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

export function DesktopNavigation() {
  return (
    <nav className="mt-8 space-y-1" aria-label="Primary navigation">
      {navigation.map((item) => (
        <NavigationLink key={item.href} {...item} />
      ))}
    </nav>
  );
}

export function MobileNavigation() {
  return (
    <nav
      className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2"
      aria-label="Mobile navigation"
    >
      {navigation.map((item) => (
        <NavigationLink key={item.href} {...item} mobile />
      ))}
    </nav>
  );
}
