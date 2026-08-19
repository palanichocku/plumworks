"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const Globe = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.25 2.46 3.5 5.67 3.5 9s-1.25 6.54-3.5 9c-2.25-2.46-3.5-5.67-3.5-9S9.75 5.46 12 3Z" /></Icon>;
const LayoutDashboard = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></Icon>;
const Users = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
const Car = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M5 17H3v-5l2-5h14l2 5v5h-2M5 17h14M7 17v2M17 17v2M5 12h14M7.5 14.5h.01M16.5 14.5h.01" /></Icon>;
const FileText = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></Icon>;
const Wallet = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6" /><path d="M16 13h4v4h-4a2 2 0 0 1 0-4Z" /></Icon>;
const Wrench = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3L12.7 4.3a4 4 0 0 0 5 5L9 18l-3 3-3-3 3-3 8.7-8.7Z" /></Icon>;
const BarChart3 = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M3 3v18h18M7 16v-4M12 16V8M17 16V5" /></Icon>;
const CircleHelp = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.8 2.13c-.8.48-1.3.87-1.3 1.87M12 17h.01" /></Icon>;
const Shield = (props: SVGProps<SVGSVGElement>) => <Icon {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></Icon>;

const navigation = [
  { href: "/repair-orders", label: "Repair Orders", icon: Wrench },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/vehicles", label: "Vehicles", icon: Car },
  { href: "/", label: "Website", icon: Globe },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/help", label: "Help", icon: CircleHelp },
  { href: "/accounts-receivable", label: "Accounts Receivable", icon: Wallet },
];

function NavigationLink({
  href,
  label,
  icon: NavigationIcon,
  mobile = false,
}: {
  href: string;
  label: string;
  icon: NavigationIcon;
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
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
            isActive
              ? "bg-brand-primary text-white"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          <NavigationIcon className="h-4 w-4" />
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
