"use client";

import { useState } from "react";
import type { QueryPerformanceWindow, RecentQuery } from "@/lib/system-health/query-performance";
import { captureSystemHealthQuerySnapshot } from "./query-actions";

const THRESHOLDS = [200, 500, 1000] as const;
const HOUR = 3_600_000;

function ms(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}
function time(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
function QuerySparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-xs text-slate-500">Building history</span>;
  const max = Math.max(1, ...points);
  const coords = points.map((n,i) => `${i * 100 / (points.length - 1)},${28 - n * 24 / max}`).join(" ");
  return <svg viewBox="0 0 100 32" className="h-8 w-24" role="img" aria-label="Recent application call volume trend">
    <polyline points={coords} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>;
}
function LatencyTrend({ trend, threshold }: { trend: QueryPerformanceWindow["trend"]; threshold: number }) {
  const points = trend.filter(item => Number.isFinite(item.maxMeanMs) && Number.isFinite(new Date(item.timestamp).getTime()));
  if (points.length < 2) return <p className="py-12 text-center text-sm text-slate-500">Collecting per-sample latency history.</p>;
  const maxY = Math.max(threshold * 1.25, ...points.map(p => p.maxMeanMs), 1);
  const minX = new Date(points[0].timestamp).getTime();
  const maxX = new Date(points[points.length - 1].timestamp).getTime();
  const x = (stamp: number) => 42 + 720 * (stamp - minX) / Math.max(1,maxX - minX);
  const y = (value: number) => 180 - 140 * value / maxY;
  // Break series across missing collection intervals; never imply data in gaps.
  const paths: string[] = [];
  let segment = "";
  points.forEach((p,i) => {
    const point = `${x(new Date(p.timestamp).getTime()).toFixed(1)},${y(p.maxMeanMs).toFixed(1)}`;
    const discontinuity = i > 0 && (new Date(p.timestamp).getTime() - new Date(points[i-1].timestamp).getTime()) > 90 * 60_000;
    segment += (i === 0 || discontinuity ? "M" : "L") + point + " ";
    if (discontinuity) {
      // Restart: omit the previous-to-current connecting line.
      segment = segment.replace(/L[^L M]+\s*$/, "");
      paths.push(segment);
      segment = "M" + point + " ";
    }
  });
  if (segment) paths.push(segment);
  return <div className="overflow-x-auto">
    <svg viewBox="0 0 800 225" className="h-auto min-w-[410px] w-full" role="img" aria-label="Highest per-query average latency by observed sample interval, with gaps omitted and threshold marked">
      {[0,threshold/2,threshold].map((v,i)=><g key={i}>
        <line x1="42" x2="774" y1={y(v)} y2={y(v)} stroke={v===threshold?"#ea580c":"#e2e8f0"} strokeDasharray={v===threshold?"5 4":undefined} />
        <text x="34" y={y(v)+4} fontSize="11" textAnchor="end" fill="#64748b">{Math.round(v)}</text>
      </g>)}
      <text x="774" y={Math.max(12,y(threshold)-7)} fontSize="11" fontWeight="600" textAnchor="end" fill="#c2410c">{threshold} ms limit</text>
      {paths.map((path,i)=><path key={i} d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>)}
      {points.map((p,i)=><circle key={i} cx={x(new Date(p.timestamp).getTime())} cy={y(p.maxMeanMs)} r={p.maxMeanMs>=threshold?4:2.5} fill={p.maxMeanMs>=threshold?"#dc2626":"#2563eb"}/>)}
      <text x="42" y="210" fontSize="11" fill="#64748b">{time(points[0].timestamp)}</text>
      <text x="774" y="210" fontSize="11" fill="#64748b" textAnchor="end">{time(points[points.length - 1].timestamp)}</text>
    </svg>
  </div>;
}

export function QueryPerformanceCard({ window, allowCapture, nowIso, supabaseUrl }: {
  window: QueryPerformanceWindow;
  allowCapture: boolean;
  nowIso: string;
  supabaseUrl: string;
}) {
  const [threshold,setThreshold] = useState<number>(500);
  const app = window.queries.filter(q=>q.classification==="application");
  const maintenance = window.queries.filter(q=>q.classification==="maintenance");
  const slow = app.filter(q=>q.meanMs >= threshold);
  const observedCalls = app.reduce((sum,q)=>sum+q.calls,0);
  const maintenanceCalls = maintenance.reduce((sum,q)=>sum+q.calls,0);
  const enough = window.coveredHours >= 2 && window.sampleCount >= 3 && observedCalls > 0;
  const stale = window.status==="stale";
  const usable = window.status==="ready" || stale;
  const state = !usable ? "unknown" : stale ? "stale" : !enough ? "limited" : slow.length ? "watch" : "healthy";
  const styles = {
    healthy: {shell:"border-emerald-200 bg-emerald-50",badge:"bg-emerald-700 text-white", text:"text-emerald-950",label:"Healthy"},
    watch: {shell:"border-amber-300 bg-amber-50",badge:"bg-amber-700 text-white",text:"text-amber-950",label:"Watch"},
    stale: {shell:"border-amber-300 bg-amber-50",badge:"bg-amber-700 text-white",text:"text-amber-950",label:"Monitoring stale"},
    limited: {shell:"border-slate-300 bg-slate-50",badge:"bg-slate-700 text-white",text:"text-slate-900",label:"Collecting"},
    unknown: {shell:"border-slate-300 bg-slate-50",badge:"bg-slate-700 text-white",text:"text-slate-900",label:"Unavailable"},
  }[state];
  const ageMin = window.latestAt ? Math.max(0,Math.floor((new Date(nowIso).getTime()-new Date(window.latestAt).getTime())/60_000)) : null;
  const ageText = ageMin===null ? "No sample" : ageMin>=60 ? `Sampled ${Math.floor(ageMin/60)} h ${ageMin%60} min ago` : `Sampled ${ageMin} min ago`;
  const totalTime = app.reduce((sum,q)=>sum+q.totalMs,0);
  const top = [...app].sort((a,b)=>b.totalMs-a.totalMs).slice(0,5);
  // Each cell represents one hour in the 24 hours preceding this page render.
  // Shading means two valid snapshots bounded the interval. It is not a confidence score.
  const now = new Date(nowIso).getTime();
  const start=now-24*HOUR;
  const blocks=Array.from({length:24},(_,i)=>{
    const b0=start+i*HOUR,b1=b0+HOUR;
    const covered=window.intervals.reduce((sum,k)=>{
      const i0=new Date(k.from).getTime(),i1=new Date(k.to).getTime();
      return sum+Math.max(0,Math.min(b1,i1)-Math.max(b0,i0));
    },0)/HOUR;
    return {coverage:Math.min(1,covered),state:covered>=0.9?"observed":covered>=0.15?"partial":"missing"};
  });
  const callTrend=window.trend.map(t=>t.calls);
  const maxRecentMean=Math.max(0,...window.trend.map(t=>t.maxMeanMs));
  return <section id="slow-queries" aria-labelledby="app-query-performance" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
      <div className="min-w-0">
        <h2 id="app-query-performance" className="text-lg font-black tracking-tight text-slate-950">Application query performance</h2>
        <p className="mt-1 text-xs text-slate-600">Measured from database snapshots, not live traffic</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-bold ${stale?"border-amber-300 bg-amber-100 text-amber-900":"border-slate-200 bg-slate-50 text-slate-700"}`}>{ageText}{stale?" · stale":""}</span>
        <label className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700">
          <span className="sr-only">Slow query threshold</span>
          Slow ≥ <select aria-label="Slow query threshold" className="min-h-11 cursor-pointer bg-white py-1 outline-none" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}>
            {THRESHOLDS.map(value=><option key={value} value={value}>{value} ms</option>)}
          </select>
        </label>
        {allowCapture && <form action={captureSystemHealthQuerySnapshot}>
          <button aria-label="Capture sample" title="Capture sample" type="submit" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M20 11a8 8 0 0 0-14.7-4.4L3 9"/><path d="M3 3v6h6"/><path d="M4 13a8 8 0 0 0 14.7 4.4L21 15"/><path d="M15 15h6v6"/>
            </svg>
          </button>
        </form>}
      </div>
    </header>
    <div className="space-y-5 px-4 pb-5 sm:px-5">
      <div role="status" className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${styles.shell}`}>
        <span className={`rounded-lg px-3 py-2 text-sm font-extrabold ${styles.badge}`}>{styles.label}</span>
        <div className={`min-w-0 flex-1 ${styles.text}`}>
          <p className="font-extrabold">{state==="healthy"?"No slow application queries in the observed period":state==="watch"?`${slow.length} application quer${slow.length===1?"y":"ies"} averaged ≥ ${threshold} ms`:state==="stale"?`Last observed: ${slow.length} slow quer${slow.length===1?"y":"ies"}; monitoring is stale`:state==="limited"?"Gathering enough application activity to assess performance":"Application performance could not be verified"}</p>
          <p className="mt-1 text-xs">{state==="stale"?"The latest snapshot is older than 2½ hours; do not treat these results as current.":state==="unknown"?window.detail:`${window.coveredHours.toFixed(1)} of the last 24 hours covered (${Math.round(window.coveredHours/24*100)}%). ${state==="limited"?"More samples are needed.":"Values may not cover the full day."}`}</p>
        </div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
          <h3 className="font-extrabold uppercase tracking-wide text-slate-600">24-hour coverage</h3>
          <span className="font-bold text-slate-900">{window.coveredHours.toFixed(1)}h / 24h ({Math.round(window.coveredHours/24*100)}%) · Longest gap {window.maximumGapMinutes===null?"—":`${Math.round(window.maximumGapMinutes)} min`}</span>
        </div>
        <div className="grid grid-cols-24 gap-1" style={{gridTemplateColumns:"repeat(24,minmax(0,1fr))"}} aria-label="24 hourly coverage bins">
          {blocks.map((b,i)=><span key={i} title={`Hour ${i+1}: ${Math.round(b.coverage*100)}% covered by valid samples`} className={`h-6 rounded-sm ${b.state==="observed"?"bg-blue-600":b.state==="partial"?"bg-amber-400":"border border-dashed border-slate-300 bg-slate-50"}`}/>)}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>{time(new Date(start))}</span>
          <span>Blue: observed · Amber: partial hour · Dashed: not observed</span>
          <span>{time(nowIso)}</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-600">Slow application queries</p><p className={`mt-1 text-3xl font-black tabular-nums ${slow.length&&usable?"text-red-700":"text-slate-950"}`}>{usable?slow.length:"—"}</p><p className="mt-1 text-xs text-slate-500">Average ≥ {threshold} ms</p></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-600">Observed application calls</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-3xl font-black tabular-nums text-slate-950">{usable?observedCalls.toLocaleString():"—"}</p><QuerySparkline points={callTrend}/></div><p className="mt-1 text-xs text-slate-500">{window.sampleCount} stored samples; last 24h</p></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs text-slate-600">Maintenance calls</p><p className="mt-1 text-3xl font-black tabular-nums text-slate-950">{usable?maintenanceCalls.toLocaleString():"—"}</p><p className="mt-1 text-xs text-slate-500">Tracked separately from app queries</p></div>
      </div>
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-extrabold text-slate-950">Top queries by total database time</h3><p className="mt-1 text-xs text-slate-600">Actual matched query counters; averages from the observation window</p></div>
          <a href={supabaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Open Supabase Query Performance ↗</a>
        </div>
        {usable && top.length>0?<div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="hidden grid-cols-[minmax(0,2.5fr)_65px_80px_135px_65px] gap-3 bg-slate-50 px-3 py-3 text-[11px] font-extrabold uppercase text-slate-600 lg:grid">
            <span>Query</span><span>Calls</span><span>Average</span><span>Avg vs limit</span><span>DB time</span>
          </div>
          {top.map((q,i)=><details key={i} className={`group border-t border-slate-200 first:border-t-0 ${q.meanMs>=threshold?"bg-red-50/50":""}`}>
            <summary className="grid cursor-pointer grid-cols-2 gap-2 px-3 py-3 text-xs lg:grid-cols-[minmax(0,2.5fr)_65px_80px_135px_65px] lg:items-center lg:gap-3">
              <span className="col-span-2 min-w-0 break-words font-mono text-slate-900 lg:col-span-1 lg:truncate">{q.sql.slice(0,110)}{q.sql.length>110?"…":""}{q.meanMs>=threshold&&<span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 font-sans font-bold text-red-800">Slow</span>}</span>
              <span className="tabular-nums"><span className="lg:hidden text-slate-500">Calls: </span>{q.calls.toLocaleString()}</span>
              <span className={`font-bold tabular-nums ${q.meanMs>=threshold?"text-red-700":"text-slate-900"}`}><span className="lg:hidden font-normal text-slate-500">Avg: </span>{ms(q.meanMs)}</span>
              <span className="col-span-2 flex items-center gap-2 lg:col-span-1"><span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full ${q.meanMs>=threshold?"bg-red-600":"bg-blue-600"}`} style={{width:`${Math.min(100,Math.max(2,q.meanMs/threshold*100))}%`}}/></span></span>
              <span className="col-span-2 tabular-nums text-slate-700 lg:col-span-1"><span className="lg:hidden text-slate-500">DB time: </span>{ms(q.totalMs)} <span className="text-slate-400">⌄</span></span>
            </summary>
            <div className="border-t border-slate-200 px-3 py-3"><p className="mb-2 text-xs text-slate-500">{(q.totalMs/Math.max(1,totalTime)*100).toFixed(1)}% of tracked application SQL time · {q.operation}</p><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-xs text-white">{q.sql}</pre></div>
          </details>)}
        </div>:<p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No comparable application query counters are available for this observation window.</p>}
      </div>
      <div>
        <div className="mb-2 flex flex-wrap justify-between gap-2"><h3 className="font-extrabold text-slate-950">Highest average query time per sample</h3><span className="text-xs text-slate-500">Recent interval averages · {threshold} ms threshold</span></div>
        <div className="rounded-xl border border-slate-200 p-3"><LatencyTrend trend={window.trend} threshold={threshold}/></div>
      </div>
      <details className="rounded-xl border border-slate-200 p-4 text-sm">
        <summary className="cursor-pointer font-bold text-slate-900">About this data</summary>
        <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
          <p>Samples are collected hourly by the separate DEV scheduler or manually using Capture sample. The last sample is considered stale after 2½ hours.</p>
          <p>Coverage represents valid snapshot intervals of at most 90 minutes. A normal hourly interval is observed, not automatically marked as a gap. This is coverage, not statistical confidence.</p>
          <p>November 3 cutover activity before the first baseline is excluded. Classifying app versus maintenance SQL is heuristic while both use the same database role.</p>
          <p>Normalized query text and cumulative PostgreSQL counters can change across statistics resets. Only queries matched across valid snapshots are counted. No p95/p99 or interval maximum is inferred.</p>
          <p>Current observation: {window.detail} {window.latestAt?`Last sample: ${time(window.latestAt)}.`:""} Longest gap: {window.maximumGapMinutes===null?"not available":`${Math.round(window.maximumGapMinutes)} minutes`}.</p>
          <p>Threshold selection changes this view only; it does not modify alert rules or database settings.</p>
          {maintenance.length>0&&<details className="mt-2 border-t border-slate-200 pt-2"><summary className="cursor-pointer font-bold">Maintenance details ({maintenance.length} statements)</summary>{maintenance.slice(0,10).map((q,i)=><pre key={i} className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2">{q.calls} calls · {ms(q.meanMs)} average · {q.sql}</pre>)}</details>}
        </div>
      </details>
    </div>
  </section>;
}
