"use client";

import { useState, type ReactNode } from "react";

export function EditRecordDialog({
  triggerLabel,
  title,
  description,
  children,
  triggerClassName,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={triggerClassName ?? "shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-primary hover:text-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20"}
    >
      {triggerLabel}
    </button>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
      <section role="dialog" aria-modal="true" aria-labelledby={`${triggerLabel.replace(/\s+/g, "-").toLowerCase()}-title`} className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${triggerLabel.replace(/\s+/g, "-").toLowerCase()}-title`} className="text-xl font-bold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div> : null}
  </>;
}
