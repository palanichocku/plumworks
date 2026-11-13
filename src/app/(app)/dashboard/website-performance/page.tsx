import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { saveMarketingSnapshot } from "./actions";

export const dynamic = "force-dynamic";
const cutover = "2026-10-01";
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
  const monthly = rows.filter((row) => !row.partial && measure(row.metrics, metric) !== null).sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime()).slice(-12);
  const max = Math.max(1, ...monthly.map((row) => measure(row.metrics, metric) ?? 0));
  return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-black text-slate-950">{title}</h2>
    <p className="mt-1 text-xs text-slate-500">Complete calendar months only. Dotted boundary: October 1, 2026 reporting cutover.</p>
    {monthly.length === 0 ? <p className="mt-5 rounded-lg bg-slate-50 p-5 text-sm text-slate-600">Monthly trend not available yet. Import complete-month records to compare before and after the switch.</p> :
      <div className="mt-5 space-y-3">{monthly.map((row) => {
        const count = measure(row.metrics, metric) ?? 0;
        const post = date(row.periodStart) >= cutover;
        return <div key={row.id} className="grid grid-cols-[90px_1fr_70px] items-center gap-3 text-xs">
          <span className="font-bold text-slate-600">{date(row.periodStart).slice(0, 7)}{post ? " ●" : ""}</span>
          <div className={`h-5 overflow-hidden rounded bg-slate-100 ${post ? "ring-1 ring-orange-300" : ""}`}>
            <div className={`h-full rounded ${shade}`} style={{ width: `${Math.max(0, count / max * 100)}%` }} />
          </div>
          <span className="text-right font-bold tabular-nums">{formatted(count)}</span>
        </div>;
      })}</div>}
    <p className="mt-3 text-xs text-slate-500">● Post-cutover. September is categorized as pre-cutover for reporting, although the technical transfer occurred September 23.</p>
  </section>;
}
export default async function WebsitePerformancePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [{ membership }, query] = await Promise.all([requirePermission("view_reports"), searchParams]);
  const rows = await prisma.marketingPerformanceSnapshot.findMany({ where: { shopId: membership.shopId }, orderBy: [{ periodEnd: "desc" }, { recordedAt: "desc" }], take: 100 });
  const snapshots: Snapshot[] = rows.map((row) => ({ ...row, metrics: row.metrics }));
  const gbp = snapshots.filter((row) => row.source === "GBP");
  const gsc = snapshots.filter((row) => row.source === "GSC");
  const latestGbp = gbp[0];
  const latestGsc = gsc[0];
  const mayEdit = membership.role === "OWNER" || membership.role === "ADMIN";
  return <div className="space-y-7 pb-12">
    <div><Link href="/dashboard" className="text-sm font-bold text-orange-700">← Back to Dashboard</Link></div>
    <PageHeading eyebrow="Marketing measurement · Batch 4" title="Website Performance Details" description="Google visibility, engagement and website migration impact. External totals are observational, not proven leads or completed calls." />
    <div className="rounded-2xl border-l-4 border-orange-500 bg-orange-50 p-5 text-sm text-orange-950">
      <p className="font-black">Website reporting cutover: October 1, 2026</p>
      <p className="mt-1">Actual domain transfer: September 23, 2026. September is a transition month included in the pre-cutover reporting period. This report does not claim the website migration caused any changes in traffic or business.</p>
    </div>
    {query.saved === "1" ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800">Snapshot saved in the development reporting database.</p> : null}
    <section className="space-y-3">
      <h2 className="text-xl font-black">Latest captured measurements</h2>
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b bg-slate-50 p-5"><h2 className="text-xl font-black">Measurement history</h2><p className="mt-1 text-sm text-slate-600">Exact periods and sources. Multi-month snapshots are not added to monthly graphs.</p></div>
      {snapshots.length ? <div className="overflow-x-auto"><table className="min-w-[700px] w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-4">Source</th><th className="p-4">Period</th><th className="p-4">Measurements</th><th className="p-4">Notes</th></tr></thead><tbody className="divide-y">{snapshots.map((row) => <tr key={row.id}><td className="p-4 font-bold">{sourceNames[row.source] || row.source}</td><td className="p-4"><Range row={row}/></td><td className="p-4">{Object.entries(row.metrics as Record<string, unknown>).map(([name, value]) => `${name}: ${value}`).join(" · ")}</td><td className="p-4 text-slate-600">{row.notes ?? "—"}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-slate-500">No snapshots recorded.</p>}
    </section>
    {mayEdit ? <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Enter a Google measurement snapshot</h2>
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
      </form></section> : null}
    <p className="text-xs text-slate-500">Metrics are sourced from Google screenshots or exports and are not independently verified call completions, store visits, or customer leads. Before-and-after changes do not establish causation.</p>
  </div>;
}
