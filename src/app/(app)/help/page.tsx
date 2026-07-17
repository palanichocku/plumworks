import { PageHeading } from "@/components/page-heading";
import { HelpCard } from "@/components/help/help-card";
import { FlowDiagram } from "@/components/help/flow-diagram";
import { HelpList, HelpSection } from "@/components/help/help-section";
import { poweredByText } from "@/lib/branding";
import { getCurrentMembership } from "@/lib/data/membership";

const modules = [
  ["Dashboard", "Quick shop summary with counts, open items, and recent activity.", "/dashboard", "A fast starting point"],
  ["Customers", "Search, view, create, and maintain customer records and history.", "/help/customers", "Customers connect vehicles and work"],
  ["Vehicles", "Maintain vehicle identity, ownership, and service history.", "/help/vehicles", "Vehicles connect work and invoices"],
  ["Repair Orders", "Build active estimates with parts and labor, then finalize them.", "/help/repair-orders", "A finalized repair order becomes an invoice"],
  ["Invoices", "Review finalized billing, print documents, and record supported payments.", "/help/invoices", "Billing history feeds reports and balances"],
  ["Receivables", "Review open balances and follow up on money still owed.", "/help/receivables", "Outstanding balances stay visible"],
  ["Reports", "Compare invoice and accounting totals for a selected date range.", "/help/reports", "A concise accounting view"],
  ["Admin", "Owner and administrator tools for shop configuration and security.", "/help/admin", "Controlled shop management"],
] as const;

export default async function HelpOverviewPage() {
  const { membership } = await getCurrentMembership();
  return (
    <div className="space-y-6">
      {/* Main Page Header */}
      <PageHeading 
        eyebrow="Help" 
        title="Shop Software Guide" 
        description="Purpose, actions, results, and expectations for every shop workflow." 
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <HelpCard title="Shop" description={membership?.shop.name ?? "Licensed shop"} />
        <HelpCard title="Software" description={poweredByText} />
        <HelpCard title="Purpose" description="Shop management software for repair orders, invoices, receivables, and reports." />
      </section>
      
      {/* Flow Diagram Block Panel */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <FlowDiagram 
          title="Overall shop workflow" 
          steps={[
            { title: "Customer", detail: "Select or create a customer." }, 
            { title: "Vehicle", detail: "Choose the vehicle receiving service." }, 
            { title: "Repair Order", detail: "Add parts and labor while work is open." }, 
            { title: "Invoice", detail: "Finalize the completed repair order." }, 
            { title: "Payment & Reports", detail: "Track paid totals and remaining balances." }
          ]} 
        />
      </div>

      {/* Grid Directory System Blocks */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map(([title, description, href, result]) => (
          <HelpCard 
            key={title} 
            title={title} 
            description={description} 
            href={href} 
            result={result} 
          />
        ))}
      </section>

      {/* Modern High-Contrast Strategy Guides Wrapper */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <HelpSection title="Quick start">
            <HelpList items={[
              "Create a repair order from Repair Orders → New Repair Order.",
              "Select an existing customer and vehicle, or create both during entry.",
              "Add parts, labor, or a canned service to the draft.",
              "Print an estimate for review.",
              "Finalize the repair order to create a read-only invoice.",
              "Record a supported payment and check Accounts Receivable.",
              "Run Reports for the applicable invoice date range."
            ]} />
          </HelpSection>
        </div>

        <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
          <HelpSection title="Important expectations" warning>
            <HelpList items={[
              "Legacy imported records may be read-only.",
              "Raw legacy rows can be skipped or collapsed when blank, invalid, duplicated, deleted, or unlinked.",
              "Finalized invoices should not be casually edited.",
              "Receivables means unpaid balance.",
              "Reports use the selected invoice date range."
            ]} />
          </HelpSection>
        </div>
      </div>
    </div>
  );
}
