"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { emailDailySalesReport, type EmailDailySalesReportState } from "@/app/(app)/reports/actions";
import { formatReportDateRange, type DailySalesReportOutput } from "@/lib/daily-sales-report-model";

const initialState: EmailDailySalesReportState = { status: "idle", message: "" };

export function EmailDailySalesReport({ from, to, output, disabled = false }: { from: string; to: string; output: DailySalesReportOutput; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [state, action] = useActionState(emailDailySalesReport, initialState);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
      >
        Email Report
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 id={titleId} className="text-lg font-bold text-slate-950">Email Daily Sales Report</h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-600">A complete PDF report will be generated securely and attached.</p>
            <form action={action} className="mt-5 space-y-4">
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <input type="hidden" name="output" value={output} />
              <label className="block text-sm font-semibold text-slate-800">
                Recipient Email
                <input
                  autoFocus
                  required
                  type="email"
                  name="recipient"
                  maxLength={254}
                  autoComplete="email"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
                />
              </label>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span className="font-semibold">Report date range:</span> {formatReportDateRange(from, to)}
                <span className="mt-1 block"><span className="font-semibold">Report type:</span> {output === "summary" ? "Summary" : "Detail"}</span>
              </div>
              {state.message ? (
                <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>
                  {state.message}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                <SendButton />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary disabled:cursor-not-allowed disabled:opacity-60">
      {pending ? "Sending…" : "Send Report"}
    </button>
  );
}
