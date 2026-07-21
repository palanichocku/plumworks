"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmailDailySalesReport } from "@/components/email-daily-sales-report";
import type { DailySalesReportOutput } from "@/lib/daily-sales-report-model";

const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-2xs outline-none transition-all focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10";

export function DailySalesReportControls({
  loadedFrom,
  loadedTo,
  formattedRange,
  generatedTime,
  invoiceCount,
  initialOutput,
  canEmail,
  summary,
  detail,
}: {
  loadedFrom: string;
  loadedTo: string;
  formattedRange: string;
  generatedTime: string;
  invoiceCount: number;
  initialOutput: DailySalesReportOutput;
  canEmail: boolean;
  summary: ReactNode;
  detail: ReactNode;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(loadedFrom);
  const [to, setTo] = useState(loadedTo);
  const [output, setOutput] = useState<DailySalesReportOutput>(initialOutput);
  const [isPending, startTransition] = useTransition();
  const dirty = from !== loadedFrom || to !== loadedTo;

  function runReport(formData: FormData) {
    const nextFrom = String(formData.get("from") ?? loadedFrom);
    const nextTo = String(formData.get("to") ?? loadedTo);
    startTransition(() => router.push(`/reports?from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}&output=${output}`));
  }

  function selectView(next: DailySalesReportOutput) {
    setOutput(next);
    const url = new URL(window.location.href);
    url.searchParams.set("from", loadedFrom);
    url.searchParams.set("to", loadedTo);
    url.searchParams.set("output", next);
    window.history.replaceState(window.history.state, "", url);
  }

  const actionsDisabled = dirty || isPending;
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row">
        <form action={runReport} aria-busy={isPending} className="flex w-full flex-1 flex-col items-end gap-4 sm:flex-row">
          <div className="grid w-full flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">From Date
              <input name="from" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">To Date
              <input name="to" type="date" required value={to} onChange={(event) => setTo(event.target.value)} className={inputClass} />
            </label>
          </div>
          <button type="submit" disabled={isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
            {isPending ? <><span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />Running…</> : "Run Report"}
          </button>
        </form>
        
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
          <fieldset className="min-w-fit">
            <legend className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Report View</legend>
            <div className="inline-flex w-full rounded-lg border border-slate-300 bg-slate-50 p-0.5 sm:w-auto">
              {(["summary", "detail"] as const).map((value) => (
                <button 
                  key={value} 
                  type="button" 
                  aria-pressed={output === value} 
                  onClick={() => selectView(value)} 
                  className={`
                    flex-1 rounded-md px-3 py-2 text-sm font-semibold capitalize transition-all sm:flex-none 
                    ${output === value 
                      ? "bg-brand-primary text-white shadow-sm" 
                      : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900"
                    }
                  `}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          
          {actionsDisabled ? (
            <span aria-disabled="true" className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-400">
              Print Report
            </span>
          ) : (
            <Link href={`/reports/print?from=${encodeURIComponent(loadedFrom)}&to=${encodeURIComponent(loadedTo)}&output=${output}`} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 sm:w-auto">
              Print Report
            </Link>
          )}
          {canEmail ? <EmailDailySalesReport from={loadedFrom} to={loadedTo} output={output} disabled={actionsDisabled} /> : null}
        </div>
      </div>

      <div role="status" aria-live="polite" className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${isPending ? "border-brand-primary/30 bg-brand-subtle text-brand-primary" : dirty ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
        <span aria-hidden="true">{isPending ? "◷" : dirty ? "⚠" : "✓"}</span>
        <span>{isPending ? "Running report…" : dirty ? "Dates changed — run the report before printing or emailing." : `Report updated • ${formattedRange} • ${invoiceCount === 0 ? "No invoices found" : `${invoiceCount.toLocaleString()} invoices included`} • Generated ${generatedTime}`}</span>
      </div>
      <p className="-mt-3 text-xs text-slate-500">Report dates use inclusive UTC calendar days. Sales are grouped by invoice date; payments are grouped by payment date.</p>
      
      {summary}
      {output === "detail" ? detail : null}
    </div>
  );
}