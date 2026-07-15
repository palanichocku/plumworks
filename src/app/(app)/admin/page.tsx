import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

const adminSections = [
  { href: "/admin/shop-settings", title: "Shop Settings", description: "Manage invoice defaults, tax behavior, warranty text, and document messages." },
  { href: "/admin/services", title: "Canned Services", description: "Manage reusable labor templates for draft repair orders." },
  { href: "/admin/staff", title: "Staff", description: "Manage shop members, roles, and pending invitations." },
  { href: "/admin/audit-log", title: "Audit Log", description: "Review recent important shop actions without sensitive field payloads." },
  { href: "/admin/data-tools", title: "Data Tools", description: "Download shop-scoped business data in standard CSV files." },
] as const;

export default async function AdminPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  return <>
    <PageHeading eyebrow="Management" title="Admin" description="Owner and administrator tools for configuring the Car Doc workspace." />
    <section className="grid gap-5 md:grid-cols-2">
      {adminSections.map((section) => <Link key={section.href} href={section.href} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-300 hover:shadow-md"><h2 className="text-lg font-semibold text-slate-950">{section.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p><span className="mt-5 inline-flex text-sm font-semibold text-sky-700">Open →</span></Link>)}
    </section>
  </>;
}
