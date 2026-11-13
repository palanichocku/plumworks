import { getGa4RecentVisitors } from "@/lib/ga4-visitor-report";

function Metric({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-sm font-bold text-slate-700">{label}</p>
    <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{value === null ? "—" : value.toLocaleString("en-US")}</p>
  </div>;
}

export async function Ga4RecentVisitorsPanel() {
  const report = await getGa4RecentVisitors();
  return <section aria-label="Recent website visits" className="space-y-4">
    <div>
      <h2 className="text-xl font-black text-slate-950">Recent website visits</h2>
      <p className="mt-1 text-sm text-slate-700">Recent activity from Google Analytics 4 · Separate from monthly visitor reporting</p>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div><h3 className="font-bold text-slate-950">Live · Last 30 minutes</h3>
          <p className="text-sm text-slate-600">Near-realtime Google visitor activity, not a full-day total.</p></div>
        {report.realtime.state === "available" ?
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Active visitors" value={report.realtime.activeUsers} />
            <Metric label="Page views" value={report.realtime.pageViews} />
          </div> :
          <p className="rounded-lg bg-white p-3 text-sm text-slate-700">{report.realtime.state === "not_configured" ?
            "Recent reporting is not configured." : "Live reporting is temporarily unavailable."}</p>}
        <p className="text-xs text-slate-600">Refresh this page to get the latest reading. A zero means no activity was returned in this 30-minute window.</p>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div><h3 className="font-bold text-slate-950">Past 24 hourly buckets · Processed</h3>
          <p className="text-sm text-slate-600">Approximate recent 24-hour view based on hourly GA4 reports; updates can lag several hours.</p></div>
        {report.hourly.state === "available" ?
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Reported sessions" value={report.hourly.sessions} />
            <Metric label="Page views" value={report.hourly.pageViews} />
          </div> :
          <p className="rounded-lg bg-white p-3 text-sm text-slate-700">{report.hourly.state === "not_configured" ?
            "Recent reporting is not configured." : report.hourly.state === "connection_error" ?
            "Hourly reporting is temporarily unavailable." : "Google has not returned processed hourly records yet."}</p>}
        <p className="text-xs text-slate-600">Not live. Sessions are summed by hour and may differ from unique visitors or finalized monthly totals. The window is 24 hourly buckets, not an exact minute-by-minute rolling period.</p>
      </div>
    </div>
  </section>;
}
