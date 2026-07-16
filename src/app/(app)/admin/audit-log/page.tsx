import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ q?: string; action?: string; entity?: string }> 
}) {
  const [{ membership }, params] = await Promise.all([getCurrentMembership(), searchParams]);
  if (!membership) return null;
  if (!hasPermission(membership.role, "view_audit_log")) return <PermissionDenied />;
  
  const q = params.q?.trim().slice(0, 100) ?? ""; 
  const action = params.action?.trim().slice(0, 100) ?? ""; 
  const entity = params.entity?.trim().slice(0, 100) ?? "";
  
  const events = await prisma.auditLog.findMany({
    where: { 
      shopId: membership.shopId, 
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}), 
      ...(entity ? { entityType: { contains: entity, mode: "insensitive" } } : {}), 
      ...(q ? { OR: [
        { actorEmail: { contains: q, mode: "insensitive" } }, 
        { action: { contains: q, mode: "insensitive" } }, 
        { entityLabel: { contains: q, mode: "insensitive" } }, 
        { contextSummary: { contains: q, mode: "insensitive" } }
      ] } : {}) 
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], 
    take: 100,
    select: { 
      id: true, 
      action: true, 
      entityType: true, 
      createdAt: true, 
      userId: true, 
      actorEmail: true, 
      actorRole: true, 
      entityLabel: true, 
      entityHref: true, 
      contextSummary: true 
    },
  });

  const labelClass = "block text-xs font-bold uppercase tracking-wider text-slate-500 w-full";
  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium outline-none transition-all focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 shadow-2xs";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Structural Back Link Navigation Button */}
      <div>
        <Link 
          href="/admin" 
          className="group inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-sky-600 transition-colors focus:outline-none"
        >
          <span className="font-mono text-sm transition-transform group-hover:-translate-x-0.5">←</span>
          Back to Admin Panel
        </Link>
      </div>

      {/* Main Page Header */}
      <PageHeading 
        eyebrow="Admin" 
        title="Audit Log" 
        description="Review chronological platform workspace event vectors. Field-level values remain encrypted." 
      />

      {/* Premium Filter Control Toolbar Grid */}
      <form className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[2fr_1fr_1fr_auto] items-end">
        <label className={labelClass}>
          Search
          <input name="q" defaultValue={q} placeholder="Actor email, action keyword, or context..." className={inputClass} />
        </label>
        
        <label className={labelClass}>
          Action type
          <input name="action" defaultValue={action} placeholder="e.g. invoice_finalized" className={inputClass} />
        </label>
        
        <label className={labelClass}>
          Entity type
          <input name="entity" defaultValue={entity} placeholder="e.g. repair_order" className={inputClass} />
        </label>
        
        <button className="h-[38px] w-full md:w-auto rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 focus:outline-none whitespace-nowrap">
          Apply Filters
        </button>
      </form>

      {/* Audit Events Data Matrix Layout Container */}
      {events.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-base font-bold text-slate-900">No matching audit events found</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">New system transactions or matching filter arrays will generate here.</p>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1100px] w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3.5">Timestamp</th>
                <th className="px-5 py-3.5">Action Executed</th>
                <th className="px-5 py-3.5">Target Entity</th>
                <th className="px-5 py-3.5">Security Actor</th>
                <th className="px-5 py-3.5">Context Summary Vector</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {events.map((event) => { 
                const label = event.entityLabel ?? event.entityType.replaceAll("_", " "); 
                const actor = event.actorEmail ?? (event.userId ? "Shop Workspace User" : "System Core Process"); 
                
                return (
                  <tr key={event.id} className="align-top transition-colors hover:bg-slate-50/30">
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-slate-400">
                      {event.createdAt.toLocaleString("en-US")}
                    </td>
                    
                    <td className="px-5 py-4 font-bold text-slate-900">
                      <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 capitalize">
                        {event.action.replaceAll("_", " ")}
                      </span>
                    </td>
                    
                    <td className="px-5 py-4">
                      {event.entityHref ? (
                        <Link href={event.entityHref} className="font-bold text-sky-600 hover:text-sky-800 transition-colors">
                          {label}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-700 capitalize">{label}</span>
                      )}
                      <span className="mt-0.5 block font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {event.entityType.replaceAll("_", " ")}
                      </span>
                    </td>
                    
                    <td className="px-5 py-4">
                      <span className="font-bold text-slate-800">{actor}</span>
                      {event.actorRole && (
                        <span className="mt-0.5 block text-xs font-medium text-slate-400">
                          Role: <strong className="font-semibold text-slate-600 uppercase tracking-wide">{event.actorRole}</strong>
                        </span>
                      )}
                    </td>
                    
                    <td className="px-5 py-4 font-medium text-slate-500 max-w-sm break-words leading-relaxed">
                      {event.contextSummary ?? "No additional transactional context recorded."}
                    </td>
                  </tr>
                ); 
              })}
            </tbody>
          </table>
          
          <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-3">
            <p className="text-xs font-medium text-slate-400">
              Query window constraint optimization active. Displaying up to 100 most recent ledger entries.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
