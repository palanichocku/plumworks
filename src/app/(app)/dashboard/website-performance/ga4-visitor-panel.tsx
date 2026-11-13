import { formatReportingMonth } from "@/lib/website-performance-trends";
import { getGa4VisitorReport, type Ga4Breakdown } from "@/lib/ga4-visitor-report";

function DataCard({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-sm font-bold text-slate-700">{label}</p>
    <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{value === null ? "—" : value.toLocaleString("en-US")}</p>
    <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
  </div>;
}
function Breakdown({ heading, rows, note }: { heading: string; rows: Ga4Breakdown[]; note: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5">
    <h4 className="text-base font-bold text-slate-900">{heading}</h4>
    <p className="mt-1 text-sm text-slate-600">{note}</p>
    {rows.length ? <div className="mt-4 space-y-3">{rows.map((row, index) =>
      <div className="flex items-center justify-between gap-3 text-sm" key={index}>
        <span className="min-w-0 break-words text-slate-700">{row.name}</span>
        <span className="shrink-0 font-bold tabular-nums text-slate-900">{row.value.toLocaleString("en-US")}</span>
      </div>
    )}</div> : <p className="mt-4 text-sm text-slate-600">Not recorded for this reporting month.</p>}
  </div>;
}
export async function Ga4VisitorPanel() {
  const report = await getGa4VisitorReport();
  return <section className="space-y-4" aria-label="Website visitor behavior from Google Analytics">
    <div>
      <h2 className="text-xl font-black text-slate-950">Visitor behavior</h2>
      <p className="mt-1 text-sm text-slate-700">Google Analytics 4 (GA4) · {formatReportingMonth(report.month)} · Last complete calendar month</p>
    </div>
    {report.state !== "available" ?
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
        <p className="font-bold text-slate-900">{report.state === "not_configured" ? "Google Analytics reporting is not connected yet." : "Google Analytics data is not available for this month."}</p>
        <p className="mt-1">Visitor counts are displayed only when a GA4 property is connected and real data is returned. No visitor totals have been estimated.</p>
        <p className="mt-2 text-slate-600">Owner setup: configure a GA4 web measurement ID for the public site, and grant a read-only reporting service account access to the correct GA4 property.</p>
      </div>
      : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataCard label="Active visitors" value={report.visitors} detail="People who actively used the website during the month; not necessarily new customers." />
          <DataCard label="Visits (sessions)" value={report.sessions} detail="Times visitors started browsing. One person may visit multiple times." />
          <DataCard label="Engaged visits" value={report.engagedSessions} detail="Visits that met Google's engagement criteria, such as lasting at least 10 seconds, recording a key event, or viewing two pages." />
          <DataCard label="Pages viewed" value={report.pageViews} detail="Total page views, including multiple views by the same visitor." />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown heading="How visitors arrived" rows={report.channels} note="Visits grouped by Google's acquisition channels, such as Organic Search or Direct." />
          <Breakdown heading="Most-viewed pages" rows={report.pages} note="Page views for the most visited paths, not unique people." />
        </div>
      </>}
    <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      GA4 visitor activity is separate from Google Search Console clicks and Business Profile interactions. Website requests and revenue attribution are tracked separately in PlumWorks and will be addressed in the Outcomes reporting phase.
    </p>
  </section>;
}
