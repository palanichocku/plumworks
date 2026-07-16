import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpCard } from "@/components/help/help-card";
import { HelpSection } from "@/components/help/help-section";

export default function AdminHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Admin" 
        description="Owner and administrator configuration modules, permission levels, and data management tools." 
      />

      {/* Component Module: Vertical Security and Access Diagram */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
          Visual structural schematic: Admin and security clearance flow (Vertical Flow)
        </div>
        <MermaidDiagram 
          title="Admin and security" 
          chart={`flowchart TD
            A["Owner or Admin"] --> B["Shop Settings"]
            A --> C["Services"]
            A --> D["Staff"]
            A --> E["Audit Log"]
            A --> F["Data Tools"]
            G["STAFF"] --> H["Blocked from Admin"]`} 
        />
      </div>

      {/* Modern High-Contrast Strategy Guide Cards Grid */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <HelpCard 
          title="Shop Settings" 
          description="Invoice configurations, tax baseline values, standard hourly labor rates, document footers, and legal warranty text." 
        />
        <HelpCard 
          title="Services" 
          description="Reusable flat-rate or labor templates designed to be copied directly into active draft work orders." 
        />
        <HelpCard 
          title="Staff" 
          description="Account membership role configurations and outstanding team registration invitations." 
        />
        <HelpCard 
          title="Audit Log" 
          description="Complete immutable history tracking who performed core actions and which specific record datasets were affected." 
        />
        <HelpCard 
          title="Data Tools" 
          description="Secure system-wide CSV exports alongside read-only tools for duplicate matching and data-quality reviews." 
        />
      </section>

      {/* High-Contrast Authorization Restrictions Warning Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Access expectation" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            The administrative control panel is restricted strictly to accounts possessing <strong className="font-semibold text-slate-900">OWNER</strong> or <strong className="font-semibold text-slate-900">ADMIN</strong> membership statuses. Users assigned standard <strong className="font-semibold text-slate-900">STAFF</strong> roles are explicitly blocked from accessing Admin interfaces or triggering sensitive administrative server actions.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
