"use client";

import { useState, type ReactNode } from "react";
import {
  canPreviewRepairOrderLayout,
  resolveRepairOrderLayout,
  type RepairOrderLayout,
} from "@/lib/repair-order-layout";

const choices: Array<{ value: RepairOrderLayout; label: string }> = [
  { value: "classic", label: "Classic" },
  { value: "guided", label: "Guided Cards" },
  { value: "split", label: "Split Workspace" },
];

export function RepairOrderLayoutSelector({
  role,
  layout,
  onChange,
}: {
  role: string | null | undefined;
  layout: RepairOrderLayout;
  onChange: (layout: RepairOrderLayout) => void;
}) {
  if (!canPreviewRepairOrderLayout(role)) return null;

  return (
    <section className="rounded-xl border border-dashed border-violet-300 bg-violet-50 p-4" aria-labelledby="repair-order-layout-preview-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="repair-order-layout-preview-title" className="text-sm font-bold text-violet-950">Repair Order Layout Preview</h2>
          <p className="mt-1 text-xs text-violet-800">Temporary owner review control. This choice is not saved.</p>
        </div>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-violet-200 bg-white p-1" role="group" aria-label="Repair order layout">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={layout === choice.value}
              onClick={() => onChange(choice.value)}
              className={`rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${layout === choice.value ? "bg-violet-700 text-white" : "text-violet-900 hover:bg-violet-100"}`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function RepairOrderWorkspace({
  role,
  overview,
  concerns,
  parts,
  labor,
  totals,
  notes,
  actions,
}: {
  role: string | null | undefined;
  overview: ReactNode;
  concerns: ReactNode;
  parts: ReactNode;
  labor: ReactNode;
  totals: ReactNode;
  notes: ReactNode;
  actions?: ReactNode;
}) {
  const [requestedLayout, setRequestedLayout] = useState<RepairOrderLayout>("classic");
  const layout = resolveRepairOrderLayout(role, requestedLayout);
  const guided = layout === "guided";
  const split = layout === "split";
  const sectionClass = guided ? "rounded-2xl bg-slate-50 p-1" : "";

  return (
    <div className="space-y-5" data-repair-order-layout={layout}>
      <RepairOrderLayoutSelector role={role} layout={layout} onChange={setRequestedLayout} />
      <div className={split ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" : "space-y-6"}>
        <div className={split ? "space-y-6 lg:col-start-2 lg:row-start-1" : sectionClass} data-ro-section="overview">{overview}</div>
        <div className={split ? "space-y-6 lg:col-start-1 lg:row-start-1" : "contents"}>
          <div className={sectionClass} data-ro-section="concerns">{concerns}</div>
          <div className={`${sectionClass} mt-6`} data-ro-section="parts">{parts}</div>
          <div className={`${sectionClass} mt-6`} data-ro-section="labor">{labor}</div>
          <div className={`${sectionClass} mt-6`} data-ro-section="notes">{notes}</div>
        </div>
        <div className={split ? "space-y-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:mt-44" : "space-y-4"} data-ro-section="totals">{totals}{actions}</div>
      </div>
    </div>
  );
}
