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
            A["Open invoice"] --> B["Record one or more payments"]
            B --> C{"Balance is zero?"}
            C -->|No| D["Invoice and receivable stay open"]
            D --> B
            C -->|Yes| E["Invoice closes automatically"]
            E --> F["Closed sale enters reports"]`}
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
          description="Payments reduce the live balance; the final payment automatically closes the invoice and enters the sale in reports."
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Expectations">
          <HelpList items={[
            "Open native invoices can accept multiple payments from Customer, Insurance, Warranty Company, or Other payers.",
            "A native invoice automatically closes when recorded payments reduce its outstanding balance to zero.",
            "Imported legacy shop invoices remain permanently locked as fully read-only records.",
            "Complete dynamic payment transaction history renders on eligible web invoices.",
            "The printable receipt view generates directly from historical invoice snapshots, ensuring subsequent customer or vehicle profile modifications never retroactively rewrite history."
          ]} />
        </HelpSection>
      </div>
    </div>
  );
}
