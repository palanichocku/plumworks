"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import type { SalesReportPeriod, SalesReportPeriodMode } from "@/lib/sales-report-period";

interface ReportFilterFormProps {
  initialPeriod: SalesReportPeriod;
  output: string;
}

const modes: Array<{ value: SalesReportPeriodMode; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 1))),
}));

export function ReportFilterForm({ initialPeriod, output }: ReportFilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<SalesReportPeriodMode>(initialPeriod.mode);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [month, setMonth] = useState(String(initialPeriod.month ?? new Date().getMonth() + 1));
  const [quarter, setQuarter] = useState(String(initialPeriod.quarter ?? Math.floor(new Date().getMonth() / 3) + 1));
  const [year, setYear] = useState(String(initialPeriod.year ?? new Date().getFullYear()));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Immediately show a loading toast
    toast.loading("Fetching report data...", { id: "run-report" });
    
    const params = new URLSearchParams({ period: mode, output });
    if (mode === "daily") {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.set("year", year);
      if (mode === "monthly") params.set("month", month);
      if (mode === "quarterly") params.set("quarter", quarter);
    }
    
    // startTransition keeps the UI responsive while Next.js fetches the new page
    startTransition(() => {
      router.push(`/reports?${params.toString()}`);
      // Replace the loading toast with a success message once the page load finishes
      toast.success("Report updated!", { id: "run-report" });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 shadow-sm print:hidden sm:p-6">
      <fieldset>
        <legend className="text-xs font-black uppercase tracking-wider text-slate-500">Report period</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:inline-flex" aria-label="Sales report period">
          {modes.map(({ value, label }) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-lg border-2 px-4 py-2 text-sm font-bold transition-colors ${mode === value ? "border-brand-primary bg-brand-primary text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      {mode === "daily" ? <>
      <div>
        <label htmlFor="from" className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2">From Date</label>
        <input 
          type="date" 
          id="from" 
          name="from" 
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border-2 border-slate-300 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white shadow-sm" 
        />
      </div>
      <div>
        <label htmlFor="to" className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2">To Date</label>
        <input 
          type="date" 
          id="to" 
          name="to" 
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border-2 border-slate-300 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white shadow-sm" 
        />
      </div>
      </> : null}
      {mode === "monthly" ? <div>
        <label htmlFor="month" className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">Month</label>
        <select id="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 shadow-sm focus:border-brand-primary sm:w-48">
          {months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div> : null}
      {mode === "quarterly" ? <div>
        <label htmlFor="quarter" className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">Quarter</label>
        <select id="quarter" value={quarter} onChange={(event) => setQuarter(event.target.value)} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 shadow-sm focus:border-brand-primary sm:w-36">
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Q{value}</option>)}
        </select>
      </div> : null}
      {mode !== "daily" ? <div>
        <label htmlFor="year" className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">Year</label>
        <input id="year" type="number" min="1" max="9998" inputMode="numeric" required value={year} onChange={(event) => setYear(event.target.value)} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 shadow-sm focus:border-brand-primary sm:w-32" />
      </div> : null}
      <button 
        type="submit" 
        disabled={isPending}
        className="bg-slate-900 text-white font-bold px-6 py-2.5 rounded-lg border-2 border-slate-900 hover:bg-slate-800 disabled:opacity-70 disabled:cursor-wait transition-colors shadow-sm"
      >
        {isPending ? "Generating..." : "Run Report"}
      </button>
      </div>
    </form>
  );
}
