"use client";

import React, { useState } from "react";
import { EmailPdfForm } from "@/components/email-pdf-form";

interface DailySalesReportControlsProps {
  loadedFrom: string;
  loadedTo: string;
  formattedRange: string;
  generatedTime: string;
  invoiceCount: number;
  initialOutput: "summary" | "detail";
  canEmail: boolean;
  reportPayload: string;
  summary: React.ReactNode;
  detail: React.ReactNode;
}

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
}: DailySalesReportControlsProps) {
  const [view, setView] = useState<"summary" | "detail">(initialOutput);

  return (
    <div className="space-y-6">
      
      {/* Print-only Header for White-Labeling */}
      <div className="hidden print:block print:mb-6 print:border-b-2 print:border-slate-800 print:pb-4">
        <h1 className="text-2xl font-black text-slate-900 uppercase tracking-wide">CAR DOC LLC</h1>
        <h2 className="mt-1 text-lg font-bold text-slate-700">Daily Sales Report</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">
          Invoice Range: {formattedRange} &middot; Generated: {generatedTime}
        </p>
      </div>

      {/* Unified Action Bar */}
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm print:hidden">
        
        {/* Left: Report Info & Toggle */}
        <div className="flex flex-col sm:flex-row items-center gap-6 w-full lg:w-auto">
          <div className="flex bg-slate-100 p-1 rounded-xl border-2 border-slate-200">
            <button
              onClick={() => setView("summary")}
              className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${
                view === "summary"
                  ? "bg-white text-slate-900 shadow-sm border-2 border-slate-200"
                  : "text-slate-500 hover:text-slate-700 border-2 border-transparent"
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setView("detail")}
              className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${
                view === "detail"
                  ? "bg-white text-brand-primary shadow-sm border-2 border-slate-200"
                  : "text-slate-500 hover:text-slate-700 border-2 border-transparent"
              }`}
            >
              Detail
            </button>
          </div>
          
          <div className="text-center sm:text-left">
            <h2 className="text-sm font-black text-slate-900">Daily Sales Report</h2>
            <p className="text-xs font-bold text-slate-500">
              {formattedRange} &middot; {invoiceCount} Invoices
            </p>
          </div>
        </div>

        {/* Right: Export Actions */}
        <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
          <button
            onClick={() => window.print()}
            className="px-5 py-2.5 text-sm font-bold text-slate-700 bg-white border-2 border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-colors shadow-sm"
          >
            Print
          </button>
          {canEmail && <EmailPdfForm fromDate={loadedFrom} toDate={loadedTo} />}
        </div>
      </div>

      {/* Content Area */}
      <div className="print:block">
        {view === "summary" ? summary : detail}
      </div>
    </div>
  );
}