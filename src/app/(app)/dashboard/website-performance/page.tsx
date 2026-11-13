import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { saveMarketingSnapshot } from "./actions";
import { GoogleReportUpload } from "./google-report-upload";
import { WebsitePerformanceTrends } from "./website-performance-trends";
import { Ga4VisitorPanel } from "./ga4-visitor-panel";

export const dynamic = "force-dynamic";
const reportingStart = "2026-10-01";
const sourceNames: Record<string, string> = { GBP: "Google Business Profile", GSC: "Google Search Console" };
type Snapshot = { id: string; source: string; periodStart: Date; periodEnd: Date; partial: boolean; metrics: unknown; notes: string | null; recordedAt: Date };
function date(value: Date) { return value.toISOString().slice(0, 10); }

export default async function WebsitePerformancePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [{ membership }, query] = await Promise.all([requirePermission("view_reports"), searchParams]);
  const rows = await prisma.marketingPerformanceSnapshot.findMany({ where: { shopId: membership.shopId }, orderBy: [{ periodEnd: "desc" }, { recordedAt: "desc" }], take: 100 });
  const snapshots: Snapshot[] = rows.map((row) => ({ ...row, metrics: row.metrics }));
  // Keep all historical imports in storage; only report measurements from the October 2026 baseline onward.
  const reportingSnapshots = snapshots.filter((row) => date(row.periodStart) >= reportingStart);
  const mayEdit = membership.role === "OWNER" || membership.role === "ADMIN";
  return <div className="space-y-7 pb-12">
    <div><Link href="/dashboard" className="text-sm font-bold text-orange-700">← Back to Dashboard</Link></div>
    <PageHeading eyebrow="Marketing measurement" title="Website Performance Details" description="Track how customers discover Car Doc and interact with its Google listings, starting October 2026." />
    {query.saved === "1" ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800">Snapshot saved in the development reporting database.</p> : null}
    <WebsitePerformanceTrends records={reportingSnapshots.map((row) => ({
      id: row.id, source: row.source, periodStart: date(row.periodStart), periodEnd: date(row.periodEnd),
      partial: row.partial, metrics: row.metrics as Record<string, unknown>, recordedAt: row.recordedAt.toISOString(),
    }))} />
    <Ga4VisitorPanel />
    {mayEdit ? <details className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <summary className="cursor-pointer bg-slate-50 p-5 font-black text-slate-900">Data Imports &amp; History</summary>
      <div className="border-t border-slate-200 p-5">
        <p className="mb-4 text-sm text-slate-600">Administrative import records from October 2026 onward. Earlier imports are retained in storage. Expand a record for its original measurements and import notes.</p>
        {reportingSnapshots.length ? <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Source</th><th className="p-3">Period</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{reportingSnapshots.map((row) =>
              <tr key={row.id}>
                <td className="p-3 font-semibold">{sourceNames[row.source] || row.source}</td>
                <td className="p-3">{date(row.periodStart)} to {date(row.periodEnd)}</td>
                <td className="p-3">{row.partial ? "Partial / multi-month" : "Complete month"}</td>
                <td className="p-3">
                  <details>
                    <summary className="cursor-pointer font-semibold text-orange-700">View record</summary>
                    <div className="mt-3 max-w-xl space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-bold">Imported measurements</p>
                      <dl className="space-y-1">{Object.entries(row.metrics as Record<string, unknown>).map(([name, value]) =>
                        <div key={name} className="flex justify-between gap-4"><dt>{name}</dt><dd className="font-semibold tabular-nums">{String(value)}</dd></div>
                      )}</dl>
                      <p className="font-bold">Original import notes</p>
                      <p className="whitespace-pre-wrap break-words">{row.notes ?? "No notes recorded."}</p>
                    </div>
                  </details>
                </td>
              </tr>
            )}</tbody>
          </table>
        </div> : <p className="text-sm text-slate-500">No reporting records from October 2026 onward.</p>}
      </div>
      <div className="space-y-4 border-t border-slate-200 p-5">
        <h3 className="text-sm font-black text-slate-800">Manage reporting imports</h3>
    <GoogleReportUpload />
    <details className="rounded-2xl border border-slate-200 bg-white p-6"><summary className="cursor-pointer text-lg font-black">Manual entry (fallback)</summary><h2 className="mt-4 text-xl font-black">Enter a Google measurement snapshot</h2>
      <p className="mt-2 text-sm text-slate-600">For OWNER/ADMIN only. Use Google-exported totals, one exact date range per record. Leave unknown fields empty rather than typing zero. Saving the same source and period replaces its prior snapshot.</p>
      <form action={saveMarketingSnapshot} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">Source<select name="source" required className="mt-2 w-full rounded-lg border p-3"><option value="GBP">Google Business Profile</option><option value="GSC">Google Search Console</option></select></label>
        <label className="text-sm font-bold">Import note<input name="notes" maxLength={1000} placeholder="Screenshot or CSV, report time range" className="mt-2 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-bold">Start date<input name="periodStart" type="date" required className="mt-2 w-full rounded-lg border p-3"/></label>
        <label className="text-sm font-bold">End date (inclusive)<input name="periodEnd" type="date" required className="mt-2 w-full rounded-lg border p-3"/></label>
        <p className="sm:col-span-2 border-b pb-2 text-sm font-black text-slate-700">Google Business Profile metrics (ignored when source is Search Console)</p>
        {([["views", "Profile views"],["interactions", "Interactions"],["calls", "Call interactions"],["directions", "Directions"],["websiteClicks", "Website clicks"],["bookings", "Bookings"]] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input name={key} min={0} type="number" step={1} className="mt-1 block w-full rounded-lg border p-3"/></label>)}
        <p className="sm:col-span-2 border-b pb-2 text-sm font-black text-slate-700">Search Console metrics (ignored when source is Business Profile)</p>
        {([["clicks", "Organic clicks"],["impressions", "Impressions"],["ctr", "Average CTR (%)"],["averagePosition", "Average position"]] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input name={key} min={0} type="number" step={key === "ctr" || key === "averagePosition" ? "0.1" : "1"} className="mt-1 block w-full rounded-lg border p-3"/></label>)}
        <button type="submit" className="sm:col-span-2 rounded-xl bg-orange-600 px-6 py-3 font-black text-white hover:bg-orange-700">Save snapshot</button>
      </form></details>
      </div>
    </details> : null}
    <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700"><strong>About these numbers:</strong> Google interactions are not verified calls, shop visits, or new customers. Website leads, conversions, and revenue are tracked separately in PlumWorks; they are not included in these Google activity counts.</p>
  </div>;
}
