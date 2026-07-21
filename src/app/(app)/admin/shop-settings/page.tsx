import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { hasPermission } from "@/lib/permissions";
import { getCurrentMembership } from "@/lib/data/membership";
import { prisma } from "@/lib/prisma";
import { updateInvoiceSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function ShopSettingsPage({
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

  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 font-medium outline-none transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 shadow-2xs";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Main Page Header */}
      <PageHeading
        eyebrow="Admin"
        title="Shop Settings"
        description="Manage invoice defaults, global tax behavior, and shop document messaging templates."
      />

      {/* Configuration Card Structure */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Invoice defaults</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            These default configurations automatically apply to all newly generated garage repair order vectors.
          </p>
        </div>

        {/* Premium Saved Alert Status Notification Banner */}
        {saved === "1" && (
          <div role="alert" className="mt-5 flex gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-2xs animate-fadeIn">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-bold text-emerald-900">✓</span>
            <div>
              <p className="font-bold text-emerald-900">Changes Saved Successfully</p>
              <p className="mt-0.5 font-medium text-emerald-700">Live invoicing algorithms and calculations have been updated in real-time.</p>
            </div>
          </div>
        )}

        <form action={updateInvoiceSettings} className="mt-6 max-w-2xl space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Default tax rate (%)
              <input 
                name="defaultTaxRate" 
                type="number" 
                min="0" 
                max="100" 
                step="0.001" 
                required 
                defaultValue={shop.defaultTaxRate.mul(100).toString()} 
                className={inputClass} 
              />
            </label>
            
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Default labor rate ($ / hr)
              <input 
                name="defaultLaborRate" 
                type="number" 
                min="0" 
                max="1000000" 
                step="0.01" 
                required 
                defaultValue={shop.defaultLaborRate.toString()} 
                className={inputClass} 
              />
            </label>
          </div>

          {/* Interactive Checkbox Tile Container Blocks */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700 bg-slate-50/20 cursor-pointer select-none transition-colors hover:bg-slate-50/70">
              <input 
                name="partsTaxable" 
                type="checkbox" 
                defaultChecked={shop.partsTaxable} 
                className="h-4 w-4 rounded-md border-slate-300 text-brand-primary focus:ring-brand-primary" 
              /> 
              Parts are taxable
            </label>
            
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-700 bg-slate-50/20 cursor-pointer select-none transition-colors hover:bg-slate-50/70">
              <input 
                name="laborTaxable" 
                type="checkbox" 
                defaultChecked={shop.laborTaxable} 
                className="h-4 w-4 rounded-md border-slate-300 text-brand-primary focus:ring-brand-primary" 
              /> 
              Labor is taxable
            </label>
          </div>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Invoice footer message
            <textarea 
              name="invoiceFooterMessage" 
              rows={3} 
              maxLength={2000} 
              defaultValue={shop.invoiceFooterMessage ?? ""} 
              placeholder="Thank you for choosing our shop..."
              className={`${inputClass} font-normal resize-none`} 
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Warranty text
            <textarea 
              name="warrantyText" 
              rows={5} 
              maxLength={4000} 
              defaultValue={shop.warrantyText ?? ""} 
              placeholder="All repairs guarantee structural coverage up to 12 months or 12,000 miles..."
              className={`${inputClass} font-normal`} 
            />
          </label>

          <button 
            type="submit" 
            className="rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20"
          >
            Save Invoice Defaults
          </button>
        </form>
      </section>
    </div>
  );
}
