import type { ReactNode } from "react";

export function RepairOrderWorkspace({ overview, concerns, parts, labor, totals, notes, actions }: {
  overview: ReactNode;
  concerns: ReactNode;
  parts: ReactNode;
  labor: ReactNode;
  totals: ReactNode;
  notes: ReactNode;
  actions?: ReactNode;
}) {
  return <div className="ro-workspace-container ro-screen min-w-0 space-y-5 rounded-3xl border border-slate-300 bg-slate-100/80 p-3 sm:p-5" data-repair-order-layout="split">
    <div className="ro-workspace-grid grid min-w-0 items-start gap-6">
      <div className="min-w-0 space-y-6" data-ro-section="overview">{overview}</div>
      <div className="min-w-0 space-y-6" data-ro-main="true">
        <div data-ro-section="concerns">{concerns}</div>
        <div data-ro-section="parts">{parts}</div>
        <div data-ro-section="labor">{labor}</div>
        <div data-ro-section="notes">{notes}</div>
      </div>
      <div className="ro-summary-column ml-auto w-full min-w-0 max-w-sm space-y-4" data-ro-section="totals">{totals}{actions}</div>
    </div>
  </div>;
}
