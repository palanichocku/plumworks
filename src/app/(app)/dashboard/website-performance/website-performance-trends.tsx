"use client";

import { useMemo, useState } from "react";
import {
  METRICS, type Metric, type MonthlySnapshot, annualMetric, availableMonths,
  changePercent, displayMetric, formatReportingMonth, metricExplanation, lastTwelveMonths, metricValue,
  monthBeforeYear, monthlyIndex, previousMonth,
} from "@/lib/website-performance-trends";

function Delta({ current, reference, metric, label }: { current: number | null; reference: number | null; metric: Metric; label: string }) {
  const change = changePercent(current, reference);
  if (change === null) return null;
  const better = change === 0 ? null : metric.lowerIsBetter ? change < 0 : change > 0;
  return <span className={`text-xs font-semibold ${better === null ? "text-slate-600" : better ? "text-emerald-700" : "text-rose-700"}`}>
    {change > 0 ? "+" : ""}{change.toFixed(1)}% vs {label}
  </span>;
}
function MetricCard({ metric, current, previous, priorYear }: { metric: Metric; current: number | null; previous: number | null; priorYear: number | null }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{metric.label}</p><p className="mt-1 text-xs text-slate-500">{metric.subtitle}</p></div><MetricInfo metric={metric} /></div>
    <p className="mt-3 text-3xl font-black tabular-nums text-slate-900">{displayMetric(current, metric)}</p>
    {previous === null && priorYear === null ? null : <div className="mt-3 flex flex-col gap-1">
      <Delta current={current} reference={previous} metric={metric} label="previous month" />
      <Delta current={current} reference={priorYear} metric={metric} label="same month last year" />
    </div>}
  </article>;
}
function MetricInfo({ metric, chart = false }: { metric: Metric; chart?: boolean }) {
  return <details className="group relative shrink-0">
    <summary aria-label={`What does ${metric.label} mean?`} title={`About ${metric.label}`} className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sm font-extrabold text-sky-800 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">i</summary>
    <div className="absolute right-0 top-9 z-20 w-[min(18rem,75vw)] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl">
      <p className="text-sm font-bold text-slate-900">{metric.label}</p>
      <p className="mt-2 text-sm font-normal leading-relaxed text-slate-700">{metricExplanation(metric)}</p>
      {chart ? <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-600">The number above each column is that month's actual measurement; the label below names the month. Taller columns mean larger numbers among the months shown. A single month is a baseline, not a trend.</p> : null}
    </div>
  </details>;
}
function TrendChart({ metric, months, values }: { metric: Metric; months: string[]; values: (number | null)[] }) {
  const actual = months.map((month, index) => ({ month, value: values[index] })).filter((item): item is { month: string; value: number } => item.value !== null);
  const max = Math.max(1, ...actual.map((item) => item.value));
  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-black text-slate-900">{metric.label}</h3>
        <p className="mt-1 text-xs text-slate-500">Complete months only · — means no imported value</p>
      </div>
      <MetricInfo metric={metric} chart />
    </div>
    {actual.length === 1 ? <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50/60 p-5 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-sky-800">Baseline month · {formatReportingMonth(actual[0].month)}</p>
      <p className="mt-3 text-3xl font-black tabular-nums text-slate-900">{displayMetric(actual[0].value, metric)}</p>
      <p className="mt-2 text-sm text-slate-600">Trend comparisons begin when another complete month is available.</p>
    </div> : actual.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">No complete-month values for this metric yet.</p> :
    <div className="mt-5 overflow-x-auto">
      <div className="grid min-h-40 min-w-[340px] items-end gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, months.length)}, minmax(0, 1fr))` }}>
        {months.map((month, index) => {
          const value = values[index];
          return <div key={month} className="flex min-w-0 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-semibold tabular-nums text-slate-700" title={value === null ? "No data" : displayMetric(value, metric)}>{displayMetric(value, metric)}</span>
            <div className="flex h-24 w-full max-w-12 items-end rounded bg-slate-50">
              {value !== null ? <div title={formatReportingMonth(month) + ": " + displayMetric(value, metric)} className="w-full rounded-t bg-sky-600" style={{ height: `${Math.max(value > 0 ? 3 : 0, value / max * 100)}%` }} /> : null}
            </div>
            <span className="text-center text-[10px] leading-tight text-slate-500">{formatReportingMonth(month, true)}</span>
          </div>;
        })}
      </div>
    </div>}
    {actual.length > 1 ? <p className="mt-3 text-xs text-slate-500">Showing {formatReportingMonth(months[0])} to {formatReportingMonth(months[months.length - 1])}</p> : null}
  </section>;
}
export function WebsitePerformanceTrends({ records }: { records: MonthlySnapshot[] }) {
  const index = useMemo(() => monthlyIndex(records), [records]);
  const months = useMemo(() => availableMonths(index), [index]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[months.length - 1];
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].filter((year) => year >= 2027 && METRICS.some((metric) => annualMetric(index, metric, year) !== null));
  const activeYear = chosenYear && years.includes(chosenYear) ? chosenYear : years[years.length - 1];
  const shownMonths = activeMonth ? lastTwelveMonths(activeMonth) : [];
  const trendMetrics = METRICS.filter((metric) => ["clicks", "impressions", "calls", "directions", "views", "websiteClicks"].includes(metric.key));
  const comparableTrends = trendMetrics.filter((metric) => shownMonths.filter((month) => metricValue(index, metric, month) !== null).length >= 2);
  const activeRecords = activeMonth ? [index.get("GSC:" + activeMonth), index.get("GBP:" + activeMonth)].filter((row): row is MonthlySnapshot => Boolean(row)) : [];
  const latestImport = activeRecords.reduce<string | null>((latest, row) => !latest || row.recordedAt > latest ? row.recordedAt : latest, null);
  const throughDate = activeRecords.length ? activeRecords.map((row) => row.periodEnd).sort()[0] : null;
  const clickMetric = METRICS.find((metric) => metric.source === "GSC" && metric.key === "clicks")!;
  const callsMetric = METRICS.find((metric) => metric.source === "GBP" && metric.key === "calls")!;
  const clicksChange = activeMonth ? changePercent(metricValue(index, clickMetric, activeMonth), metricValue(index, clickMetric, previousMonth(activeMonth))) : null;
  const callsChange = activeMonth ? changePercent(metricValue(index, callsMetric, activeMonth), metricValue(index, callsMetric, previousMonth(activeMonth))) : null;
  const trendMessage = (label: string, change: number) => change === 0 ? label + " stayed level" : label + (change > 0 ? " increased " : " decreased ") + Math.abs(change).toFixed(1) + "%";
  return <section className="space-y-5" aria-label="Website performance trends and comparisons">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-slate-950">Performance summary &amp; trends</h2>
        <p className="mt-1 text-sm text-slate-600">Track complete months beginning October 2026. The Yearly view unlocks after 12 complete monthly records in a calendar year.</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1" aria-label="Reporting view">
        <button type="button" onClick={() => setView("monthly")} aria-pressed={view === "monthly"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "monthly" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>Monthly</button>
        <button type="button" disabled={!years.length} title={years.length ? "View complete calendar years" : "Available after 12 complete reporting months in a calendar year"} onClick={() => setView("yearly")} aria-pressed={view === "yearly"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "yearly" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"} disabled:cursor-not-allowed disabled:opacity-40`}>Yearly</button>
      </div>
    </div>
    {view === "monthly" ? <>
      {activeMonth ? <>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">Reporting month
          <select aria-label="Reporting month" value={activeMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            {[...months].reverse().map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-600">Data through {throughDate ? new Date(throughDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"} · Last imported {latestImport ? new Date(latestImport).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"} · Sources: Google Search Console and Google Business Profile</p>
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4 text-sm text-sky-950">
          {clicksChange === null && callsChange === null
            ? <><strong>{formatReportingMonth(activeMonth)} is the reporting baseline.</strong> Monthly comparisons will appear after another complete month is imported. Year-over-year comparisons begin when the same month in the previous year is available.</>
            : <><strong>Monthly snapshot:</strong> {[clicksChange !== null ? trendMessage("Search clicks", clicksChange) : null, callsChange !== null ? trendMessage("Google call button taps", callsChange) : null].filter(Boolean).join("; ")} versus the previous month. Google interactions do not necessarily represent new customers.</>}
        </div>
        {(["GSC", "GBP"] as const).map((source) => <section key={source} className="space-y-3">
          <div><h3 className="text-lg font-black text-slate-950">{source === "GSC" ? "Website in Google Search" : "Google Business Listing"}</h3><p className="text-sm text-slate-600">{source === "GSC" ? "How Car Doc appears in organic Google results" : "How people interact with Car Doc's Google Business Profile"}</p></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {METRICS.filter((metric) => metric.source === source).map((metric) => <MetricCard key={metric.source + metric.key} metric={metric}
              current={metricValue(index, metric, activeMonth)}
              previous={metricValue(index, metric, previousMonth(activeMonth))}
              priorYear={metricValue(index, metric, monthBeforeYear(activeMonth))} />)}
          </div>
        </section>)}
        {comparableTrends.length ? <section className="space-y-3">
          <h3 className="text-lg font-black text-slate-950">Monthly Trends</h3>
          <p className="text-sm text-slate-600">Charts appear when at least two complete months of the same metric are available.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {comparableTrends.map((metric) => <TrendChart key={metric.source + metric.key} metric={metric} months={shownMonths} values={shownMonths.map((month) => metricValue(index, metric, month))} />)}
          </div>
        </section> : null}
      </> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No complete Google reporting months available yet. Import an October 2026 or later complete-month report to start the trend history.</p>}
    </> : <>
      <p className="text-sm text-slate-600">Yearly totals are available only after a full January–December year has 12 complete monthly records for each metric. The October–December 2026 startup period is not a full year and is never compared to one.</p>
      {activeYear ? <>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">Calendar year
          <select aria-label="Calendar year" value={activeYear} onChange={(e) => setChosenYear(Number(e.target.value))} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            {[...years].reverse().map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.filter((metric) => !["ctr", "averagePosition"].includes(metric.key)).map((metric) => {
            const current = annualMetric(index, metric, activeYear);
            const priorYear = annualMetric(index, metric, activeYear - 1);
            return <article key={metric.source + metric.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{metric.label}</p>
              <p className="mt-3 text-3xl font-black tabular-nums text-slate-900">{displayMetric(current, metric)}</p>
              <div className="mt-3"><Delta current={current} reference={priorYear} metric={metric} label="previous full year" /></div>
            </article>;
          })}
        </div>
        <p className="text-xs text-slate-600">Annual comparisons require complete matching years. CTR and average position are not summed across months. Year-over-year comparisons appear once the preceding full year is available.</p>
      </> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">Annual reporting starts with calendar year 2027. Complete-year totals and comparisons will appear once sufficient months have been imported.</p>}
    </>}
  </section>;
}
