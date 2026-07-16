import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpCard } from "@/components/help/help-card";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function InvoicesHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Invoices" 
        description="Finalized accounting ledger items and service history." 
      />

      {/* Component Module: Vertical Billing & Settlement Diagram */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
          Visual structural schematic: Invoice, payment, and receivables flow (Vertical Flow)
        </div>
        <MermaidDiagram 
          title="Invoice, payment, and receivables" 
          chart={`flowchart TD
            A["Invoice finalized"] --> B["Paid total updated"]
            B --> C{"Balance remains?"}
            C -->|Yes| D["Receivable stays open"]
            D --> E["Payment reduces balance"]
            E --> F["Reports update"]
            C -->|No| F`} 
        />
      </div>

      {/* Modern High-Contrast Strategy Guide Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <HelpCard 
          title="Purpose" 
          description="Keep finalized billing documents and immutable service history records secure." 
        />
        <HelpCard 
          title="Actions" 
          description="Search, view, print, and securely record payments for supported web-created invoices." 
        />
        <HelpCard 
          title="Result" 
          description="Invoice transaction totals immediately contribute to shop reports and live open balances." 
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Expectations">
          <HelpList items={[
            "Finalized live web invoices are securely locked and behave as mostly read-only files.",
            "Imported legacy shop invoices remain permanently locked as fully read-only records.",
            "Complete dynamic payment transaction history renders on eligible web invoices.",
            "The printable receipt view generates directly from historical invoice snapshots, ensuring subsequent customer or vehicle profile modifications never retroactively rewrite history."
          ]} />
        </HelpSection>
      </div>
    </div>
  );
}
