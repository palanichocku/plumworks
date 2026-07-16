import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function ReportsHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Reports" 
        description="Accounting summaries and financial aggregates across imported and web-created invoices." 
      />

      {/* Component Module: Vertical Reports Flowchart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
          Visual structural schematic: Reports and accounting logic (Vertical Flow)
        </div>
        <MermaidDiagram 
          title="Reports and accounting" 
          chart={`flowchart TD
            A["Invoices in selected date range"] --> B["Gross Sales"]
            A --> C["Parts Total"]
            A --> D["Labor Total"]
            A --> E["Tax Total"]
            A --> F["Payments Received"]
            A --> G["Receivables"]`} 
        />
      </div>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Report definitions">
          <HelpList items={[
            "Invoice Count: The complete tally of unique invoices dated within the selected timeframe.",
            "Gross Sales: The total combined sum of all absolute invoice totals.",
            "Parts Total: The standalone cumulative sum of all parts line-item totals.",
            "Labor Total: The standalone cumulative sum of all shop labor line-item totals.",
            "Tax Total: The absolute accumulated sum of all calculated invoice tax fields.",
            "Payments Received: The aggregate paid totals tracked directly on invoices within the active date range.",
            "Receivables: The outstanding unpaid balance calculations remaining for invoices in the selected range."
          ]} />
        </HelpSection>
      </div>

      {/* High-Contrast Analytical Accounting Warning Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Expectation" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            Reports generate metrics explicitly bounded by the selected invoice date range. The <strong className="font-semibold text-slate-900">Payments Received</strong> field evaluates the current aggregate paid totals stored on each included invoice record; it does not split or segregate legacy-versus-web ledger configurations.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
