import type { ReactNode } from "react";

export function RepairOrderWorkspace({ overview, concerns, parts, labor, totals, notes, actions, lineItemsWorkbench = false }: {
  overview: ReactNode;
  concerns: ReactNode;
  parts: ReactNode;
  labor: ReactNode;
  totals: ReactNode;
  notes: ReactNode;
  actions?: ReactNode;
  lineItemsWorkbench?: boolean;
}) {
  return <div className="ro-workspace-container ro-screen min-w-0 space-y-5 rounded-3xl border border-slate-300 bg-slate-100/80 p-3 sm:p-5" data-repair-order-layout="split">
    <style>{`
      .ro-workspace-container [data-ro-section="overview"] > section:first-child .ro-section-heading {
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0;
        box-shadow: none;
      }
      .ro-workspace-container [data-ro-section="overview"] > section:first-child .ro-section-heading + div button {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        text-decoration: underline;
        text-underline-offset: 4px;
      }
    `}</style>
    <div className="ro-workspace-grid grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1" data-ro-section="overview">{overview}</div>
      <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-2" data-ro-main="true">
        <div data-ro-section="concerns">{concerns}</div>
        {lineItemsWorkbench ? <div className="ro-line-workbench min-w-0" data-ro-line-workbench="true">
          <div className="min-w-0" data-ro-section="parts">{parts}</div>
          <div className="min-w-0" data-ro-section="labor">{labor}</div>
        </div> : <>
          <div data-ro-section="parts">{parts}</div>
          <div data-ro-section="labor">{labor}</div>
        </>}
        <div data-ro-section="notes">{notes}</div>
      </div>
      <aside className="ro-summary-column w-full min-w-0 space-y-4 xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:self-start" data-ro-section="totals">{totals}{actions}</aside>
    </div>
  </div>;
}
