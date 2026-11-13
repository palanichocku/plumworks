"use client";

import { useMemo, useState } from "react";
import {
  METRICS, type Metric, type MonthlySnapshot, annualMetric, availableMonths,
  changePercent, displayMetric, lastTwelveMonths, metricValue,
  monthBeforeYear, monthlyIndex, previousMonth,
} from "@/lib/website-performance-trends";

function MonthLabel({ month }: { month: string }) {
  const [year, number] = month.split("-").map(Number);
  return <>{new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)))}</>;
}
function Delta({ current, reference, metric, label }: { current: number | null; reference: number | null; metric: Metric; label: string }) {
  const change = changePercent(current, reference);
  if (change === null) return <span className="text-xs text-slate-500">No comparable {label} data</span>;
  const better = change === 0 ? null : metric.lowerIsBetter ? change < 0 : change > 0;
  return <span className={`text-xs font-semibold ${better === null ? "text-slate-600" : better ? "text-emerald-700" : "text-rose-700"}`}>
    {change > 0 ? "+" : ""}{change.toFixed(1)}% vs {label}
  </span>;
}
function MetricCard({ metric, current, previous, priorYear }: { metric: Metric; current: number | null; previous: number | null; priorYear: number | null }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{metric.label}</p>
    <p className="mt-3 text-3xl font-black tabular-nums text-slate-900">{displayMetric(current, metric)}</p>
    <div className="mt-3 flex flex-col gap-1">
      <Delta current={current} reference={previous} metric={metric} label="previous month" />
      <Delta current={current} reference={priorYear} metric={metric} label="same month last year" />
    </div>
  </article>;
}
function TrendChart({ metric, months, values }: { metric: Metric; months: string[]; values: (number | null)[] }) {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <h3 className="text-sm font-black text-slate-900">{metric.label}</h3>
    <p className="mt-1 text-xs text-slate-500">Up to 12 complete months · — means no imported value</p>
    <div className="mt-5 grid min-h-36 items-end gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, months.length)}, minmax(0, 1fr))` }}>
      {months.map((month, i) => {
        const v = values[i];
        return <div key={month} className="flex min-w-0 flex-col items-center justify-end gap-1">
          <span title={v === null ? "No data" : displayMetric(v, metric)} className="max-w-full truncate text-[10px] font-semibold tabular-nums text-slate-700">{v === null ? "—" : displayMetric(v, metric)}</span>
          <div className="flex h-24 w-full items-end rounded bg-slate-50">
            {v !== null ? <div title={month + ": " + displayMetric(v, metric)} className="w-full rounded-t bg-sky-600" style={{ height: `${Math.max(v > 0 ? 3 : 0, v / max * 100)}%` }} /> : null}
          </div>
          <span className="max-w-full truncate text-[10px] text-slate-500">{month.slice(5)}</span>
        </div>;
      })}
    </div>
    <p className="mt-2 text-xs text-slate-500">{months.length ? months[0] + " to " + months[months.length - 1] : "No complete months imported"}</p>
  </section>;
}
export function WebsitePerformanceTrends({ records }: { records: MonthlySnapshot[] }) {
  const index = useMemo(() => monthlyIndex(records), [records]);
  const months = useMemo(() => availableMonths(index), [index]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[months.length - 1];
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].filter((year) => year >= 2027);
  const activeYear = chosenYear && years.includes(chosenYear) ? chosenYear : years[years.length - 1];
  const shownMonths = activeMonth ? lastTwelveMonths(activeMonth) : [];
  const trendMetrics = METRICS.filter((metric) => ["clicks", "impressions", "calls", "directions", "views", "websiteClicks"].includes(metric.key));
  return <section className="space-y-5" aria-label="Website performance trends and comparisons">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-slate-950">Performance summary &amp; trends</h2>
        <p className="mt-1 text-sm text-slate-600">Compare complete Google reporting months from October 2026 onward.</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1" aria-label="Reporting view">
        <button type="button" onClick={() => setView("monthly")} aria-pressed={view === "monthly"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "monthly" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>Monthly</button>
        <button type="button" onClick={() => setView("yearly")} aria-pressed={view === "yearly"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "yearly" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>Yearly</button>
      </div>
    </div>
    {view === "monthly" ? <>
      {activeMonth ? <>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">Reporting month
          <select aria-label="Reporting month" value={activeMonth} onChange={(event) => setSelectedMonth(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            {[...months].reverse().map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <p className="text-sm text-slate-600">Selected: <strong><MonthLabel month={activeMonth} /></strong>. Comparisons are only shown when the corresponding complete-month metric exists; October 2026 is the baseline.</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => <MetricCard key={metric.source + metric.key} metric={metric}
            current={metricValue(index, metric, activeMonth)}
            previous={metricValue(index, metric, previousMonth(activeMonth))}
            priorYear={metricValue(index, metric, monthBeforeYear(activeMonth))} />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {trendMetrics.map((metric) => <TrendChart key={metric.source + metric.key} metric={metric} months={shownMonths} values={shownMonths.map((month) => metricValue(index, metric, month))} />)}
        </div>
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
