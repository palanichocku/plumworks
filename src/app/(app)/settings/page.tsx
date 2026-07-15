import { PageHeading } from "@/components/page-heading";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { hasPermission } from "@/lib/permissions";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import { updateInvoiceSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ membership }, { saved }] = await Promise.all([
    getCurrentMembership(),
    searchParams,
  ]);

  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  const shop = await prisma.shop.findUnique({
    where: { id: membership.shopId },
    select: {
      defaultTaxRate: true,
      defaultLaborRate: true,
      partsTaxable: true,
      laborTaxable: true,
      invoiceFooterMessage: true,
      warrantyText: true,
    },
  });

  if (!shop) return null;

  return (
    <>
      <PageHeading
        eyebrow="Workspace"
        title="Settings"
        description="Manage general application and shop preferences."
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Invoice defaults</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">These settings apply only when a web-created repair order is finalized in the future.</p>
        {saved === "1" && <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">Invoice settings saved.</p>}
        <form action={updateInvoiceSettings} className="mt-6 max-w-2xl space-y-5">
          <label className="block text-sm font-semibold text-slate-700">Default tax rate (%)<input name="defaultTaxRate" type="number" min="0" max="100" step="0.001" required defaultValue={shop.defaultTaxRate.mul(100).toString()} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Default labor rate<input name="defaultLaborRate" type="number" min="0" max="1000000" step="0.01" required defaultValue={shop.defaultLaborRate.toString()} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-sm font-semibold text-slate-700"><input name="partsTaxable" type="checkbox" defaultChecked={shop.partsTaxable} className="size-4" /> Parts are taxable</label>
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-sm font-semibold text-slate-700"><input name="laborTaxable" type="checkbox" defaultChecked={shop.laborTaxable} className="size-4" /> Labor is taxable</label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Invoice footer message<textarea name="invoiceFooterMessage" rows={3} maxLength={2000} defaultValue={shop.invoiceFooterMessage ?? ""} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Warranty text<textarea name="warrantyText" rows={5} maxLength={4000} defaultValue={shop.warrantyText ?? ""} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
          <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">Save invoice settings</button>
        </form>
      </section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Common services</h2><p className="mt-2 text-sm text-slate-600">Manage reusable labor templates for draft repair orders.</p><Link href="/settings/services" className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Manage common services</Link></section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Audit log</h2><p className="mt-2 text-sm text-slate-600">Review recent important shop actions without sensitive field payloads.</p><Link href="/settings/audit-log" className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">View audit log</Link></section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Staff</h2><p className="mt-2 text-sm text-slate-600">Manage shop members, roles, and pending invitations.</p><Link href="/settings/staff" className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Manage staff</Link></section>
    </>
  );
}
