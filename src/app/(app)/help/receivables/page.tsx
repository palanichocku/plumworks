import { PageHeading } from "@/components/page-heading";
import { HelpCard } from "@/components/help/help-card";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function ReceivablesHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Receivables" 
        description="Locate and track outstanding customer invoices with unpaid balances." 
      />

      {/* Modern High-Contrast Strategy Guide Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <HelpCard 
          title="Purpose" 
          description="Provide a focused, dedicated view of all outstanding money still owed to the shop." 
        />
        <HelpCard 
          title="Actions" 
          description="Filter between open, paid, or comprehensive balances; search by customer or RO; immediately open the target invoice." 
        />
        <HelpCard 
          title="Result" 
          description="The shop manager or owner can rapidly identify outstanding balances requiring collection or follow-up." 
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="How to read the page">
          <HelpList items={[
            "Total reflects the finalized, all-inclusive baseline invoice amount.",
            "Paid displays the cumulative historical transaction amounts credited directly to the invoice.",
            "Balance indicates the current outstanding calculation still waiting to be paid.",
            "Open states signify that a positive balance remains; Paid marks that the outstanding balance has successfully hit zero."
          ]} />
        </HelpSection>
      </div>

      {/* High-Contrast Read-Only Workflow Warning Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Expectation" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            Receivables tracking acts strictly as an analytical view of remaining unpaid balances. To process or record customer transactions, <strong className="font-semibold text-slate-900">use the standard active invoice payment workflow</strong>; this monitoring workspace does not create, modify, or delete payment logs.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
