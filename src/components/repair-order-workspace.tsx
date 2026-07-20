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
  return <div className="space-y-5" data-repair-order-layout="split">
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6 lg:col-start-2 lg:row-start-1" data-ro-section="overview">{overview}</div>
      <div className="space-y-6 lg:col-start-1 lg:row-start-1">
        <div data-ro-section="concerns">{concerns}</div>
        <div data-ro-section="parts">{parts}</div>
        <div data-ro-section="labor">{labor}</div>
        <div data-ro-section="notes">{notes}</div>
      </div>
      <div className="space-y-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:mt-44" data-ro-section="totals">{totals}{actions}</div>
    </div>
  </div>;
}
