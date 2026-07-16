import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function WorkflowHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Shop Workflow" 
        description="How information moves from intake through billing and reporting lifecycle stages." 
      />

      {/* Structural Diagrams Layout Container Grid */}
      <div className="space-y-6">
        {/* Component Module 1: Overall Shop Core Flow */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
            Visual structural schematic: Shop intake lifecycle vectors (Vertical Flow)
          </div>
          <MermaidDiagram 
            title="Overall shop workflow" 
            chart={`flowchart TD
              A["Customer arrives"] --> B["Select or create customer"]
              B --> C["Select or create vehicle"]
              C --> D["Create repair order"]
              D --> E["Add labor, parts, or canned services"]
              E --> F["Print estimate"]
              F --> G["Finalize invoice"]
              G --> H{"Paid in full?"}
              H -->|Yes| I["Record payment"]
              H -->|No| J["Leave receivable open"]
              I --> K["Reports updated"]
              J --> K`} 
          />
        </div>

        {/* Component Module 2: Accounting & Settlement Flow */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
            Visual structural schematic: Transaction ledger vectors (Vertical Flow)
          </div>
          <MermaidDiagram 
            title="Invoice, payment, and receivables flow" 
            chart={`flowchart TD
              A["Invoice finalized"] --> B["Paid total updated"]
              B --> C{"Balance remains?"}
              C -->|Yes| D["Receivable stays open"]
              D --> E["Payment reduces balance"]
              E --> F["Reports update"]
              C -->|No| F`} 
          />
        </div>
      </div>

      {/* High-Contrast Daily Blueprint Panel */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50/10 p-6 shadow-sm">
        <HelpSection title="Daily pattern">
          <HelpList items={[
            "Begin on the primary Dashboard overview to inspect active garage floor work and open balances.",
            "Always utilize global search queries before creating structural duplicate customers or vehicle folders.",
            "Keep all active work folders fully editable as a draft or an open repair order.",
            "Thoroughly review structural lines and tax totals before finalization, as this locks records as read-only assets.",
            "Consistently monitor the system Invoice and Receivables pages for complete billing and customer follow-up."
          ]} />
        </HelpSection>
      </div>
    </div>
  );
}
