import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

const adminSections = [
  { href: "/admin/app-settings", title: "App Settings", description: "Manage application appearance and workspace theme." },
  { href: "/admin/shop-settings", title: "Shop Settings", description: "Manage invoice defaults, tax behavior, warranty text, and document messages." },
  { href: "/admin/services", title: "Services", description: "Manage reusable labor templates for draft repair orders." },
  { href: "/admin/leads", title: "Marketing Leads", description: "Review public contact, appointment, and drop-off requests." },
  { href: "/admin/staff", title: "Staff", description: "Manage shop members, roles, and pending invitations." },
  { href: "/admin/audit-log", title: "Audit Log", description: "Review recent important shop actions without sensitive field payloads." },
  { href: "/admin/data-tools", title: "Data Tools", description: "Download shop-scoped business data in standard CSV files." },
] as const;

export default async function AdminPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Management"
        title="Admin Control Panel"
        description="Owner and administrator tools for configuring this shop workspace, permissions, and operations."
      />

      <section className="grid gap-4 sm:grid-cols-2">
        {adminSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-primary/30 hover:shadow-md"
          >
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-brand-primary opacity-0 transition-opacity group-hover:opacity-100" />
            <div>
              <h2 className="text-base font-bold text-slate-900 group-hover:text-brand-primary transition-colors">
                {section.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 font-medium">
                {section.description}
              </p>
            </div>
            <div className="mt-6 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-400 group-hover:text-brand-primary transition-colors">
              Open Admin Tool
              <span className="font-mono text-sm transform transition-transform group-hover:translate-x-1">→</span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}