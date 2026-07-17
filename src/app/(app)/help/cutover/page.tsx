import { PageHeading } from "@/components/page-heading";
import { MermaidDiagram } from "@/components/help/mermaid-diagram";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function CutoverHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Legacy Cutover" 
        description="How approved Windows data becomes the production shop database for a licensed shop deployment." 
      />

      {/* Component Module: Vertical Cutover Flowchart */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 italic">
          Visual structural schematic: Legacy cutover and data reload sequence (Vertical Flow)
        </div>
        <MermaidDiagram 
          title="Legacy cutover and reload" 
          chart={`flowchart TD
            A["Latest Windows data copy"] --> B["Backup Supabase"]
            B --> C["Reset operational data"]
            C --> D["Reload legacy data"]
            D --> E["Verify"]
            E --> F{"Final report"}
            F --> G["PASS"]
            F --> H["PASS WITH WARNINGS"]
            F --> I["FAIL"]
            G --> J["Web app go-live"]
            H --> J`} 
        />
      </div>

      {/* Main Documentation Block Matrix */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <HelpSection title="What is preserved">
            <HelpList items={[
              "Active Supabase Auth users and associated shop memberships.",
              "Established shop identity details and foundational invoice defaults.",
              "Pending staff invitations and pre-configured canned services.",
              "Database migrations, permission tables, RLS policies, and core API protections."
            ]} />
          </HelpSection>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <HelpSection title="Status meanings">
            <HelpList items={[
              "PASS: Required data validation and verification checks completed entirely without warnings.",
              "PASS WITH WARNINGS: Technical checks passed successfully, but with expected raw-to-clean schema gaps or specific review items.",
              "FAIL: A critical pipeline exception or issue occurred; halt the process immediately and resolve it before trusting the reload dataset."
            ]} />
          </HelpSection>
        </div>
      </div>

      {/* High-Contrast Destructive Cutover Actions & Warning Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Cutover expectations" warning>
          <HelpList items={[
            "The standalone Windows desktop application remains the source of truth until the licensed shop deployment is approved for production cutover.",
            "A full database backup sequence must complete successfully before any destructive operations or resets begin.",
            "Raw legacy rows may be skipped, filtered, or collapsed when determined to be deleted, blank, invalid, duplicated, or unlinked.",
            "All structural web users, high-level Admin configurations, and shop defaults remain fully preserved.",
            "Rely on the saved final cutover report alongside the managed Supabase restore/PITR strategy for verification and absolute rollback readiness."
          ]} />
        </HelpSection>
      </div>
    </div>
  );
}
