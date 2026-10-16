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
      .ro-workspace-container [data-ro-section="overview"] > section:first-child .ro-section-heading + div > button {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        text-decoration: underline;
        text-underline-offset: 4px;
      }
      .ro-line-items-surface .ro-line-card {
        border: 0;
        border-radius: 0;
        background: transparent;
        padding: 0;
        box-shadow: none;
      }
      .ro-line-items-surface .ro-line-workbench {
        gap: 0;
      }
      .ro-line-items-surface [data-ro-section="parts"],
      .ro-line-items-surface [data-ro-section="labor"] {
        padding: 1rem;
      }
      .ro-summary-stack > * {
        margin: 0 !important;
        max-width: none !important;
        width: 100% !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      .ro-summary-stack > * + * {
        border-top: 1px solid #e2e8f0 !important;
      }
      @container (min-width: 80rem) {
        .ro-workspace-grid > [data-ro-section="overview"] {
          grid-column: 1 !important;
          grid-row: 1 !important;
        }
        .ro-workspace-grid > [data-ro-main="true"] {
          grid-column: 1 !important;
          grid-row: 2 !important;
        }
        .ro-summary-column {
          position: sticky !important;
          top: 1.5rem !important;
          grid-column: 2 !important;
          grid-row: 1 / span 2 !important;
          width: 100% !important;
          margin-top: 0 !important;
        }
      }
      @media (min-width: 64rem) {
        .ro-line-items-surface [data-ro-section="parts"] {
          border-right: 1px solid #cbd5e1;
        }
      }
      @media (max-width: 63.999rem) {
        .ro-line-items-surface [data-ro-section="labor"] {
          border-top: 1px solid #cbd5e1;
        }
      }
    `}</style>
    <div className="ro-workspace-grid grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1" data-ro-section="overview">{overview}</div>
      <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-2" data-ro-main="true">
        <div data-ro-section="concerns">{concerns}</div>
        {lineItemsWorkbench ? <section className="ro-line-items-surface overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm" aria-labelledby="repair-order-line-items-title">
          <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
            <h2 id="repair-order-line-items-title" className="text-base font-bold text-slate-900">Line items</h2>
          </div>
          <div className="ro-line-workbench min-w-0" data-ro-line-workbench="true">
            <div className="min-w-0" data-ro-section="parts">{parts}</div>
            <div className="min-w-0" data-ro-section="labor">{labor}</div>
          </div>
        </section> : <>
          <div data-ro-section="parts">{parts}</div>
          <div data-ro-section="labor">{labor}</div>
        </>}
        <div data-ro-section="notes">{notes}</div>
      </div>
      <aside className="ro-summary-column w-full min-w-0 xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:self-start" data-ro-section="totals">
        {actions ? <div className="ro-summary-stack overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{totals}{actions}</div> : totals}
      </aside>
    </div>
  </div>;
}
