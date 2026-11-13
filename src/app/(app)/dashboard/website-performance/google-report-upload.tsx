"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { confirmGooglePerformanceImport, previewGooglePerformanceImport, type GoogleImportPreview } from "./actions";

const names: Record<string,string> = { GBP: "Google Business Profile", GSC: "Google Search Console" };
function number(v: number | undefined) { return v === undefined ? "Not recorded" : new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v); }

export function GoogleReportUpload() {
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState<GoogleImportPreview|null>(null);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState("");
  const [replace,setReplace] = useState(false);
  const [ackOverlaps,setAckOverlaps] = useState(false);
  const [busy, startTransition] = useTransition();
  function choose(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
    setPreview(null); setError(""); setSuccess(""); setReplace(false); setAckOverlaps(false);
  }
  function form() {
    const data = new FormData();
    if (file) data.set("report",file);
    return data;
  }
  function inspect() {
    if (!file) { setError("Choose a report first."); return; }
    startTransition(async () => {
      try {
        const result = await previewGooglePerformanceImport(form());
        setPreview(result);
        setError("");
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "The report could not be inspected.");
      }
    });
  }
  function confirm() {
    if (!file || !preview) return;
    startTransition(async () => {
      try {
        const data=form();
        if(replace) data.set("replace","yes");
        if(ackOverlaps) data.set("ackOverlaps","yes");
        const result=await confirmGooglePerformanceImport(data);
        setSuccess(`Imported ${result.imported} report period(s); replaced ${result.replaced} existing period(s). Refresh the page to see updated charts.`);
        setPreview(null);setError("");setFile(null);
      } catch(err) {
        setError(err instanceof Error?err.message:"Import failed. No data was saved.");
      }
    });
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black text-slate-950">Upload Google report</h2><p className="mt-1 text-sm text-slate-600">Preview first. Nothing is stored until you confirm.</p></div>
      <span className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Owner / Admin only</span>
    </div>
    <div className="mt-5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5">
      <label htmlFor="google-performance-file" className="block text-sm font-bold text-slate-800">Choose original Google export (.csv or .zip, up to 3 MB)</label>
      <input id="google-performance-file" type="file" accept=".csv,.zip,text/csv,application/zip" onChange={choose}
        className="mt-3 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-orange-600 file:px-4 file:py-2 file:font-bold file:text-white"/>
      <p className="mt-2 text-xs text-slate-600">Search Console: full ZIP download or daily Chart.csv. Business Profile: original Local reports CSV, with dates preserved in its filename. Excel (.xlsx) is not yet supported; use CSV.</p>
      <button type="button" disabled={!file||busy} onClick={inspect} className="mt-4 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy?"Checking…":"Preview import"}</button>
    </div>
    {error?<p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>:null}
    {success?<p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{success}</p>:null}
    {preview?<div className="mt-5 space-y-4">
      <div className="rounded-xl bg-blue-50 p-4 text-sm"><p className="font-black text-blue-950">Detected: {names[preview.report.source]}</p>
        <p className="text-blue-800">{preview.report.snapshots.length} reporting period(s) · {file?.name}</p>
        {preview.report.businessName?<p className="text-blue-800">Business: {preview.report.businessName}</p>:null}
      </div>
      {preview.report.warnings.map((warning,i)=><p key={i} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
      <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[530px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th className="p-3">Reporting period</th><th className="p-3">Data status</th><th className="p-3">Metrics from source</th></tr></thead>
          <tbody className="divide-y">{preview.report.snapshots.map((row,i)=><tr key={i}><td className="p-3 font-bold">{row.periodStart} – {row.periodEnd}</td><td className="p-3">{row.partial?"Partial / multi-month":"Full month"}</td>
            <td className="p-3">{preview.report.source==="GBP"?`Views ${number(row.metrics.views)} · Calls ${number(row.metrics.calls)} · Directions ${number(row.metrics.directions)} · Website ${number(row.metrics.websiteClicks)}`:`Clicks ${number(row.metrics.clicks)} · Impressions ${number(row.metrics.impressions)} · CTR ${number(row.metrics.ctr)}% · Position ${number(row.metrics.averagePosition)}`}</td></tr>)}</tbody>
        </table>
      </div>
      {preview.duplicates.length?<label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={replace} onChange={(e)=>setReplace(e.currentTarget.checked)} className="mt-1"/><span><strong>{preview.duplicates.length} exact period(s) already exist.</strong> I approve replacing their measurements with this import.</span></label>:null}
      {preview.overlaps.length?<label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={ackOverlaps} onChange={(e)=>setAckOverlaps(e.currentTarget.checked)} className="mt-1"/><span><strong>{preview.overlaps.length} new period(s) overlap existing data.</strong> I understand these overlapping reports remain separately stored and are never added to monthly charts unless a period is a complete calendar month.</span></label>:null}
      <button type="button" disabled={busy||(preview.duplicates.length>0&&!replace)||(preview.overlaps.length>0&&!ackOverlaps)} onClick={confirm}
        className="rounded-lg bg-orange-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{busy?"Importing…":"Confirm and save report"}</button>
    </div>:null}
  </section>;
}
