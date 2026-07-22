"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

interface ReportFilterFormProps {
  initialFrom: string;
  initialTo: string;
  output: string;
}

export function ReportFilterForm({ initialFrom, initialTo, output }: ReportFilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Immediately show a loading toast
    toast.loading("Fetching report data...", { id: "run-report" });
    
    const params = new URLSearchParams({ from, to, output });
    
    // startTransition keeps the UI responsive while Next.js fetches the new page
    startTransition(() => {
      router.push(`/reports?${params.toString()}`);
      // Replace the loading toast with a success message once the page load finishes
      toast.success("Report updated!", { id: "run-report" });
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50 p-6 shadow-sm print:hidden">
      <div>
        <label htmlFor="from" className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-2">From Date</label>
        <input 
          type="date" 
          id="from" 
          name="from" 
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
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border-2 border-slate-300 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white shadow-sm" 
        />
      </div>
      <button 
        type="submit" 
        disabled={isPending}
        className="bg-slate-900 text-white font-bold px-6 py-2.5 rounded-lg border-2 border-slate-900 hover:bg-slate-800 disabled:opacity-70 disabled:cursor-wait transition-colors shadow-sm"
      >
        {isPending ? "Generating..." : "Run Report"}
      </button>
    </form>
  );
}