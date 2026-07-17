import { PageHeading } from "@/components/page-heading";
import { HelpCard } from "@/components/help/help-card";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function CustomersHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Customers" 
        description="Manage the people and organizations connected to shop work." 
      />

      {/* Modern High-Contrast Strategy Guide Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <HelpCard 
          title="Purpose" 
          description="Keep one shop-scoped customer record connected to vehicles, repair orders, invoices, and service history." 
        />
        <HelpCard 
          title="Actions" 
          description="Search, view, create during repair-order intake, edit contact details, and review linked history." 
        />
        <HelpCard 
          title="Result" 
          description="The selected customer becomes the owner/billing link for vehicle and repair activity." 
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Recommended workflow">
          <HelpList items={[
            "Search comprehensively by name or phone number before creating a new record to avoid duplicates.",
            "Open the customer detail view to review linked vehicles and complete chronological service history.",
            "Use the Edit tool to update the live cloud database record; note that legacy read-only assets are never modified.",
            "Quickly create a new customer alongside a new vehicle directly from the New Repair Order workspace when needed."
          ]} />
        </HelpSection>
      </div>

      {/* High-Contrast Data Integrity Expectation Block */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Expectation" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            Imported legacy customer directories can be updated in the shop platform, but those edits <strong className="font-semibold text-slate-900">never</strong> write back to the frozen Windows legacy files. Furthermore, finalized historical invoice snapshots remain fully immutable and unchanged for compliance.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
