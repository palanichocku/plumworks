"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Ga4RecentVisitors } from "@/lib/ga4-visitor-report";
import { loadRecentGa4Visitors } from "./ga4-recent-actions";

const STORAGE_KEY = "plumworks:ga4-recent-visits-enabled";
const MIN_REFRESH_MS = 60_000;

function Metric({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-sm font-bold text-slate-700">{label}</p>
    <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{value === null ? "—" : value.toLocaleString("en-US")}</p>
  </div>;
}

export function Ga4RecentVisitorsPanel() {
  // Start OFF on first visit; persist this preference in this browser only.
  const [enabled, setEnabled] = useState(false);
  const [loadedPreference, setLoadedPreference] = useState(false);
  const [report, setReport] = useState<Ga4RecentVisitors | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cachedReport = useRef<Ga4RecentVisitors | null>(null);
  const lastRequestAt = useRef(0);
  const requestCounter = useRef(0);
  const enabledRef = useRef(false);

  const refresh = useCallback(() => {
    const now = Date.now();
    if (!enabledRef.current || now - lastRequestAt.current < MIN_REFRESH_MS) return;
    lastRequestAt.current = now;
    setCooldownUntil(now + MIN_REFRESH_MS);
    setError(false);
    const request = ++requestCounter.current;
    startTransition(async () => {
      try {
        const result = await loadRecentGa4Visitors();
        if (enabledRef.current && requestCounter.current === request) { cachedReport.current = result; setReport(result); }
      } catch {
        if (enabledRef.current && requestCounter.current === request) setError(true);
      }
    });
  }, []);

  useEffect(() => {
    let saved = false;
    try { saved = window.localStorage.getItem(STORAGE_KEY) === "true"; } catch { /* Browser storage may be blocked. */ }
    enabledRef.current = saved;
    setEnabled(saved);
    setLoadedPreference(true);
    if (saved) {
      // Restore the owner's preference; this is the only automatic request.
      // There is no background polling or timer.
      lastRequestAt.current = 0;
      const now = Date.now();
      lastRequestAt.current = now;
      setCooldownUntil(now + MIN_REFRESH_MS);
      const request = ++requestCounter.current;
      startTransition(async () => {
        try {
          const result = await loadRecentGa4Visitors();
          if (enabledRef.current && requestCounter.current === request) setReport(result);
        } catch {
          if (enabledRef.current && requestCounter.current === request) setError(true);
        }
      });
    }
  }, []);

  function toggle() {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Preference is optional. */ }
    if (!next) {
      ++requestCounter.current;
      setReport(null);
      setError(false);
      return;
    }
    // User explicitly turned reporting back on. A previous request less than
    // one minute ago does not need to run again; show existing data if available.
    if (Date.now() - lastRequestAt.current < MIN_REFRESH_MS) {
      if (cachedReport.current) setReport(cachedReport.current);
      return;
    }
    refresh();
  }

  useEffect(() => {
    if (!enabled || !cooldownUntil) return;
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      setCooldownUntil(0);
      return;
    }
    // This timer only re-enables the button; it never calls Google.
    const timer = window.setTimeout(() => setCooldownUntil(0), remaining);
    return () => window.clearTimeout(timer);
  }, [enabled, cooldownUntil]);
  const canRefresh = enabled && !pending && cooldownUntil === 0;
  const updated = report?.refreshedAt ? new Date(report.refreshedAt).toLocaleString("en-US", {
    timeZone: "America/Detroit", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) + " ET" : null;

  return <section aria-label="Recent website visits" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-slate-950">Recent website visits</h2>
        <p className="mt-1 text-sm text-slate-700">Optional Google Analytics 4 activity · Separate from monthly visitor reporting</p>
      </div>
      <div className="flex items-center gap-3">
        {enabled ? <button type="button" onClick={() => { if (canRefresh) refresh(); }}
          disabled={!canRefresh} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Loading…" : "Refresh"}
        </button> : null}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
          <span>{enabled ? "On" : "Off"}</span>
          <input type="checkbox" role="switch" aria-label="Show recent website visits"
            checked={enabled} disabled={!loadedPreference} onChange={toggle}
            className="peer sr-only" />
          <span aria-hidden="true" className="relative h-7 w-12 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-4 peer-focus-visible:ring-orange-400/50 peer-disabled:opacity-50
            after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
    </div>
    {!enabled ?
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-700">
        Recent visitor reporting is off. Turn it on to load live and processed activity. Public website tracking continues normally.
      </div>
      : <>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600" aria-live="polite">
          <span>{updated ? `Last updated: ${updated}` : pending ? "Loading recent activity…" : error ? "Could not load recent activity." : "No recent report loaded yet."}</span>
          <span>Manual refresh only · At most once per 60 seconds</span>
        </div>
        {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">The recent visitor request failed. Try Refresh again after one minute. Monthly reporting is unaffected.</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div><h3 className="font-bold text-slate-950">Live · Last 30 minutes</h3>
              <p className="text-sm text-slate-600">Near-realtime Google visitor activity, not a full-day total.</p></div>
            {report?.realtime.state === "available" ?
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Active visitors" value={report.realtime.activeUsers} />
                <Metric label="Page views" value={report.realtime.pageViews} />
              </div> :
              <p className="rounded-lg bg-white p-3 text-sm text-slate-700">{!report ? pending ? "Loading…" : "No data loaded." :
                report.realtime.state === "not_configured" ? "Recent reporting is not configured." : "Live reporting is temporarily unavailable."}</p>}
            <p className="text-xs text-slate-600">A zero means no activity was returned for this 30-minute window.</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div><h3 className="font-bold text-slate-950">Past 24 hourly buckets · Processed</h3>
              <p className="text-sm text-slate-600">Approximate recent 24-hour view based on hourly GA4 reports; updates can lag several hours.</p></div>
            {report?.hourly.state === "available" ?
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Reported sessions" value={report.hourly.sessions} />
                <Metric label="Page views" value={report.hourly.pageViews} />
              </div> :
              <p className="rounded-lg bg-white p-3 text-sm text-slate-700">{!report ? pending ? "Loading…" : "No data loaded." :
                report.hourly.state === "not_configured" ? "Recent reporting is not configured." :
                  report.hourly.state === "connection_error" ? "Hourly reporting is temporarily unavailable." :
                    "Google has not returned processed hourly records yet."}</p>}
            <p className="text-xs text-slate-600">Not live. Sessions are summed by hour and may differ from unique visitors or finalized monthly totals. This is not an exact minute-by-minute rolling period.</p>
          </div>
        </div>
      </>}
  </section>;
}
