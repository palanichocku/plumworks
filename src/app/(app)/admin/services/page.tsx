import { PageHeading } from "@/components/page-heading";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createCannedService, deleteCannedService, updateCannedService } from "./actions";

export const dynamic = "force-dynamic";

export default async function CannedServicesPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "manage_canned_services")) return <PermissionDenied />;
  
  const services = await prisma.cannedService.findMany({ 
    where: { shopId: membership.shopId }, 
    orderBy: [{ active: "desc" }, { name: "asc" }] 
  });

  const labelClass = "block text-xs font-bold uppercase tracking-wider text-slate-500 w-full";
  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium outline-none transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 shadow-2xs";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Main Page Header */}
      <PageHeading 
        eyebrow="Admin" 
        title="Services" 
        description="Manage reusable labor templates that can be easily injected directly into draft repair orders." 
      />

      {/* Canned Services List Container */}
      <section className="space-y-4">
        {services.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm font-medium text-slate-500 text-center">
            No canned services have been configured yet.
          </p>
        ) : (
          services.map((service) => (
            <form 
              key={service.id} 
              action={updateCannedService} 
              className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.5fr_2.5fr_7rem_9rem_auto] lg:items-end transition-all hover:border-slate-300"
            >
              <input type="hidden" name="serviceId" value={service.id} />
              
              <label className={labelClass}>
                Service name
                <input name="name" required maxLength={100} defaultValue={service.name} className={inputClass} />
              </label>
              
              <label className={labelClass}>
                Description
                <input name="description" required maxLength={500} defaultValue={service.description} className={inputClass} />
              </label>
              
              <label className={labelClass}>
                Hours
                <input name="defaultHours" type="number" required min="0.01" max="1000" step="0.01" defaultValue={service.defaultHours.toString()} className={inputClass} />
              </label>
              
              <label className={labelClass}>
                Labor rate
                <input name="defaultLaborRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={service.defaultLaborRate.toString()} className={inputClass} />
              </label>
              
              <div className="flex items-center gap-2 pt-2 lg:pt-0">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50/40 cursor-pointer select-none transition-colors hover:bg-slate-50">
                  <input name="active" type="checkbox" defaultChecked={service.active} className="h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary" /> 
                  Active
                </label>
                
                <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 focus:outline-none" type="submit">
                  Save
                </button>
                
                <FormSubmitButton 
                  formAction={deleteCannedService} 
                  pendingLabel="Deleting…" 
                  confirmTitle="Delete this canned service?" 
                  confirmDescription="This cannot be undone. Existing repair-order and invoice lines will remain unchanged." 
                  confirmLabel="Delete service" 
                  destructive 
                  className="rounded-lg border border-red-200 bg-red-50/30 px-3 py-2 text-sm font-semibold text-red-600 shadow-2xs transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  Delete
                </FormSubmitButton>
              </div>
            </form>
          ))
        )}
      </section>

      {/* Add New Service Panel */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Add template service</h2>
          <p className="mt-0.5 text-sm font-medium text-slate-500">Create a reusable catalog workflow shortcut.</p>
        </div>
        
        <form action={createCannedService} className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_2.5fr_7rem_9rem_auto] lg:items-end">
          <label className={labelClass}>
            Service name
            <input name="name" required maxLength={100} placeholder="e.g. Synthetic Oil Change" className={inputClass} />
          </label>
          
          <label className={labelClass}>
            Description
            <input name="description" required maxLength={500} placeholder="e.g. Full synthetic replacement with filter change" className={inputClass} />
          </label>
          
          <label className={labelClass}>
            Hours
            <input name="defaultHours" type="number" required min="0.01" max="1000" step="0.01" defaultValue="1" className={inputClass} />
          </label>
          
          <label className={labelClass}>
            Labor rate ($ / hr)
            <input name="defaultLaborRate" type="number" required min="0" max="1000000" step="0.01" defaultValue="60" className={inputClass} />
          </label>
          
          <div className="flex items-center gap-3 pt-2 lg:pt-0">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-50/40 cursor-pointer select-none transition-colors hover:bg-slate-50">
              <input name="active" type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary" /> 
              Active
            </label>
            
            <button type="submit" className="rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/20">
              Add Template
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
