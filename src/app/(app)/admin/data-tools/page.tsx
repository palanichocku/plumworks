import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

const exports = [
  { type: "customers", title: "Customers Dataset", description: "Customer contact directories, profile attributes, and location indices." },
  { type: "vehicles", title: "Vehicles Dataset", description: "Vehicle structural identifiers, matching attributes, and owner linkages." },
  { type: "invoices", title: "Invoices Ledger", description: "Invoice identifiers, shop transactional relations, and finalized summaries." },
  { type: "accounts-receivable", title: "Accounts Receivable", description: "Outstanding collection ledger statements, balances, and aging states." },
  { type: "repair-orders", title: "Repair Orders Archive", description: "Staging floor drafts, active garage folders, and finalized order metrics." },
] as const;

export default async function DataToolsPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "export_shop_data")) return <PermissionDenied />;

  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Main Page Header */}
      <PageHeading 
        eyebrow="Portability" 
        title="Data Tools" 
        description="Extract workspace records, download standard comma-separated assets, or execute administrative deduplication audits." 
      />

      {/* Modern High-Contrast Row/Column Data Grid Container */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-3 text-xs font-medium text-slate-400 italic">
          Available administrative workspace assets and exports
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75">
                <th className={thClass}>Asset Engine Module</th>
                <th className={thClass}>Data Coverage Context</th>
                <th className={`${thClass} text-right pr-6`}>Execution Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              
              {/* Row 1: The Premium Highlighted Duplicate Finder Segment */}
              <tr className="group transition-colors bg-brand-subtle/20 hover:bg-brand-subtle/50">
                <td className="px-5 py-4 font-bold text-slate-900">
                  <span className="inline-flex items-center gap-2 text-brand-primary">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Duplicate Profile Finder
                  </span>
                </td>
                <td className="px-5 py-4 font-medium text-slate-500 max-w-sm">
                  Scans database sequences to flags matching telephone, name, or VIN markers without altering live records.
                </td>
                <td className="px-5 py-4 text-right pr-6 whitespace-nowrap">
                  <Link 
                    href="/admin/data-tools/duplicates" 
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-primary px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-2xs transition-colors hover:bg-brand-primary focus:outline-none"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Review Duplicates
                  </Link>
                </td>
              </tr>

              {/* Rows 2+: The Core System Standard Export Vectors */}
              {exports.map((item) => (
                <tr key={item.type} className="group transition-colors hover:bg-slate-50/60">
                  <td className="px-5 py-4 font-bold text-slate-800 group-hover:text-slate-900">
                    {item.title}
                  </td>
                  <td className="px-5 py-4 font-medium text-slate-400 group-hover:text-slate-500 transition-colors">
                    {item.description}
                  </td>
                  <td className="px-5 py-4 text-right pr-6 whitespace-nowrap">
                    <a 
                      href={`/admin/data-tools/${item.type}`} 
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
                    >
                      <svg className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download CSV
                    </a>
                  </td>
                </tr>
              ))}

            </tbody>
          </table>
        </div>

        {/* Structural Card Footer Summary Context */}
        <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-3">
          <p className="text-xs font-medium text-slate-400 italic">
            * Data compilation is constrained exclusively to the active shop space profile. Operational credentials, workspace roles, and secure audit sequences are completely omitted.
          </p>
        </div>
      </div>
    </div>
  );
}
