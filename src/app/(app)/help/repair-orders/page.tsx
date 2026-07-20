import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpCard } from "@/components/help/help-card";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function RepairOrdersHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Repair Orders" 
        description="The active work and estimate area for the shop." 
      />

      {/* Component Module: Vertical Lifecycle Diagram */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
          Visual structural schematic: Order lifecycle vectors (Vertical Flow)
        </div>
        <MermaidDiagram 
          title="Repair order lifecycle" 
          chart={`flowchart TD
            A["Draft"] --> B["Open"]
            B --> C["Add parts and labor"]
            C --> D["Print estimate"]
            D --> E["Finalized invoice"]
            E --> F["Read-only history"]`} 
        />
      </div>

      {/* Modern High-Contrast Strategy Guide Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <HelpCard 
          title="Purpose" 
          description="Represent work before it becomes a finalized bill." 
        />
        <HelpCard 
          title="Actions" 
          description="Create, add parts and labor, use services, print, delete eligible drafts, and finalize." 
        />
        <HelpCard 
          title="Result" 
          description="Create Invoice opens an editable invoice and makes the repair order read-only."
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Editing rules">
          <HelpList items={[
            "Web-created draft/open repair orders can be edited freely.",
            "Imported legacy open orders remain locked as read-only.",
            "Draft deletion removes the order framework but safely keeps the linked customer and vehicle intact.",
            "Finalization cannot be repeated or undone, and explicitly requires a valid customer, vehicle, and repair-order number."
          ]} />
        </HelpSection>
      </div>

      {/* High-Contrast Critical Finalization Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Before finalizing" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            Carefully review customer details, vehicle parameters, parts, labor lines, tax valuations, and estimated totals. Finalization copies snapshot data and lines directly into an invoice and <strong className="font-semibold text-slate-900">should be treated as an irreversible billing step</strong>.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
