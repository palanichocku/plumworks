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
  return <div className="ro-workspace-container ro-screen min-w-0 rounded-3xl border border-slate-300 bg-slate-100/80 p-3 sm:p-5" data-repair-order-layout="top-summary">
    <style>{`
      .ro-workspace-container [data-ro-section="overview"] > section:first-child .ro-section-heading + div > button {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        text-decoration: underline;
        text-underline-offset: 4px;
      }
      .ro-workspace-container [data-ro-section="overview"] > section:first-child > div.grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .ro-workspace-container [data-ro-section="overview"] > section:first-child > div.grid > :nth-child(1) {
        border-right: 0 !important;
      }
      .ro-workspace-container [data-ro-section="overview"] > section:first-child > div.grid > :nth-child(2) {
        border-top: 1px solid #e2e8f0 !important;
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
      @container (min-width: 64rem) {
        .ro-top-workbench {
          grid-template-columns: minmax(0, 1fr) 20rem !important;
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
    <div className="ro-workspace-grid transaction-workspace-width grid min-w-0 items-start gap-5">
      <div className="ro-top-workbench grid min-w-0 items-start gap-5">
        <div className="min-w-0" data-ro-section="overview">{overview}</div>
        <aside className="ro-summary-column w-full min-w-0" data-ro-section="totals">
          {actions ? <div className="ro-summary-stack overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-sm">{totals}{actions}</div> : totals}
        </aside>
      </div>
      <div className="min-w-0 space-y-5" data-ro-main="true">
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
    </div>
  </div>;
}
