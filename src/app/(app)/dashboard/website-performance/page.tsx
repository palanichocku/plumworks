import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { saveMarketingSnapshot } from "./actions";
import { GoogleReportUpload } from "./google-report-upload";

export const dynamic = "force-dynamic";
const reportingStart = "2026-10-01";
const sourceNames: Record<string, string> = { GBP: "Google Business Profile", GSC: "Google Search Console" };
type Snapshot = { id: string; source: string; periodStart: Date; periodEnd: Date; partial: boolean; metrics: unknown; notes: string | null; recordedAt: Date };
function measure(raw: unknown, name: string): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function date(value: Date) { return value.toISOString().slice(0, 10); }
function formatted(value: number | null, suffix = "") { return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 1 }) + suffix; }
function Range({ row }: { row: Snapshot }) {
  return <span>{date(row.periodStart)} to {date(row.periodEnd)}{row.partial ? " · partial / multi-month" : " · complete month"}</span>;
}
function Stat({ name, value, color }: { name: string; value: string; color: string }) {
  return <div className={`rounded-2xl border p-5 shadow-sm ${color}`}><p className="text-xs font-bold uppercase tracking-wide opacity-75">{name}</p><p className="mt-3 text-3xl font-black tabular-nums">{value}</p></div>;
}
function Trend({ title, rows, metric, shade }: { title: string; rows: Snapshot[]; metric: string; shade: string }) {
  // Never plot overlapping or partial multi-month snapshots as monthly numbers.
  const monthly = rows.filter((row) => !row.partial && date(row.periodStart) >= reportingStart && measure(row.metrics, metric) !== null).sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime()).slice(-12);
  const max = Math.max(1, ...monthly.map((row) => measure(row.metrics, metric) ?? 0));
  return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-black text-slate-950">{title}</h2>
    <p className="mt-1 text-xs text-slate-500">Complete reporting months from October 2026 onward. Missing months remain blank.</p>
    {monthly.length === 0 ? <p className="mt-5 rounded-lg bg-slate-50 p-5 text-sm text-slate-600">Monthly trend not available yet. Import complete-month records starting October 2026.</p> :
      <div className="mt-5 space-y-3">{monthly.map((row) => {
        const count = measure(row.metrics, metric) ?? 0;
        return <div key={row.id} className="grid grid-cols-[90px_1fr_70px] items-center gap-3 text-xs">
          <span className="font-bold text-slate-600">{date(row.periodStart).slice(0, 7)}</span>
          <div className="h-5 overflow-hidden rounded bg-slate-100">
            <div className={`h-full rounded ${shade}`} style={{ width: `${Math.max(0, count / max * 100)}%` }} />
          </div>
          <span className="text-right font-bold tabular-nums">{formatted(count)}</span>
        </div>;
      })}</div>}
  </section>;
}

export default async function WebsitePerformancePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [{ membership }, query] = await Promise.all([requirePermission("view_reports"), searchParams]);
  const rows = await prisma.marketingPerformanceSnapshot.findMany({ where: { shopId: membership.shopId }, orderBy: [{ periodEnd: "desc" }, { recordedAt: "desc" }], take: 100 });
  const snapshots: Snapshot[] = rows.map((row) => ({ ...row, metrics: row.metrics }));
  // Keep all historical imports in storage; only report measurements from the October 2026 baseline onward.
  const reportingSnapshots = snapshots.filter((row) => date(row.periodStart) >= reportingStart);
  const gbp = reportingSnapshots.filter((row) => row.source === "GBP");
  const gsc = reportingSnapshots.filter((row) => row.source === "GSC");
  const latestGbp = gbp.find((row) => !row.partial);
  const latestGsc = gsc.find((row) => !row.partial);
  const mayEdit = membership.role === "OWNER" || membership.role === "ADMIN";
  return <div className="space-y-7 pb-12">
    <div><Link href="/dashboard" className="text-sm font-bold text-orange-700">← Back to Dashboard</Link></div>
    <PageHeading eyebrow="Marketing measurement" title="Website Performance Details" description="Track how customers discover Car Doc and interact with its Google listings, starting October 2026." />
    <div className="rounded-2xl border-l-4 border-orange-500 bg-orange-50 p-5 text-sm text-orange-950">
      <p className="font-black">Reporting baseline: October 1, 2026</p>
      <p className="mt-1">October 2026 is the first reporting month. Monthly measurements will build a history over time; unavailable information is displayed as —, not zero. Earlier imports are retained for recordkeeping but are not used in these reports.</p>
    </div>
    {query.saved === "1" ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800">Snapshot saved in the development reporting database.</p> : null}
    <section className="space-y-3">
      <h2 className="text-xl font-black">Google visibility and local engagement</h2>
      <p className="text-sm text-slate-600">Latest available complete reporting month for each source. Google interactions are not confirmed calls, visits, or website leads.</p>
      {latestGbp ? <><p className="text-sm font-semibold text-slate-600">Google Business Profile · <Range row={latestGbp} /></p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat name="Profile views" value={formatted(measure(latestGbp.metrics, "views"))} color="border-blue-200 bg-blue-50 text-blue-950" />
          <Stat name="Google call interactions" value={formatted(measure(latestGbp.metrics, "calls"))} color="border-emerald-200 bg-emerald-50 text-emerald-950" />
          <Stat name="Direction requests" value={formatted(measure(latestGbp.metrics, "directions"))} color="border-orange-200 bg-orange-50 text-orange-950" />
          <Stat name="Google website clicks" value={formatted(measure(latestGbp.metrics, "websiteClicks"))} color="border-violet-200 bg-violet-50 text-violet-950" />
        </div></> : <p className="rounded-xl border p-5 text-sm text-slate-500">No Google Business Profile snapshot imported.</p>}
      {latestGsc ? <><p className="pt-3 text-sm font-semibold text-slate-600">Google Search Console · <Range row={latestGsc} /></p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat name="Organic clicks" value={formatted(measure(latestGsc.metrics, "clicks"))} color="border-blue-200 bg-blue-50 text-blue-950" />
          <Stat name="Organic impressions" value={formatted(measure(latestGsc.metrics, "impressions"))} color="border-violet-200 bg-violet-50 text-violet-950" />
          <Stat name="Average CTR" value={formatted(measure(latestGsc.metrics, "ctr"), "%")} color="border-emerald-200 bg-emerald-50 text-emerald-950" />
          <Stat name="Average position" value={formatted(measure(latestGsc.metrics, "averagePosition"))} color="border-orange-200 bg-orange-50 text-orange-950" />
        </div></> : null}
    </section>
    <section className="grid gap-4 lg:grid-cols-2">
      <Trend title="Organic search clicks by month" rows={gsc} metric="clicks" shade="bg-blue-500" />
      <Trend title="Google Profile calls by month" rows={gbp} metric="calls" shade="bg-emerald-500" />
      <Trend title="Search impressions by month" rows={gsc} metric="impressions" shade="bg-violet-500" />
      <Trend title="Google directions by month" rows={gbp} metric="directions" shade="bg-orange-500" />
    </section>
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
    </details> : null}
    {mayEdit ? <GoogleReportUpload /> : null}
    {mayEdit ? <details className="rounded-2xl border border-slate-200 bg-white p-6"><summary className="cursor-pointer text-lg font-black">Manual entry (fallback)</summary><h2 className="mt-4 text-xl font-black">Enter a Google measurement snapshot</h2>
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
      </form></details> : null}
    <p className="text-xs text-slate-500">Google metrics are sourced from imported reports. Call interactions and direction requests are not independently verified calls or shop visits. Customer conversion and attributed revenue are tracked separately in PlumWorks.</p>
  </div>;
}
