import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

const exports = [
  { type: "customers", title: "Customers CSV", description: "Customer contact and location fields." },
  { type: "vehicles", title: "Vehicles CSV", description: "Vehicle identifiers and linked customer names." },
  { type: "invoices", title: "Invoices CSV", description: "Invoice identifiers, relationships, and totals." },
  { type: "accounts-receivable", title: "Accounts Receivable CSV", description: "Receivable balances and statuses." },
  { type: "repair-orders", title: "Repair Orders CSV", description: "Draft, open, imported, and finalized repair-order totals." },
] as const;

export default async function DataToolsPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "export_shop_data")) return <PermissionDenied />;

  return <>
    <Link href="/admin" className="text-sm font-semibold text-sky-700 hover:text-sky-800">← Admin</Link>
    <div className="mt-5"><PageHeading eyebrow="Portability" title="Data Tools" description="Download read-only CSV exports of this shop's clean application data." /></div>
    <section className="grid gap-4 md:grid-cols-2">
      {exports.map((item) => <article key={item.type} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">{item.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p><a href={`/admin/data-tools/${item.type}`} className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Download CSV</a></article>)}
    </section>
    <p className="mt-6 text-xs leading-5 text-slate-500">Exports are limited to the current shop. Staff, authentication, and audit-log records are not included.</p>
  </>;
}
