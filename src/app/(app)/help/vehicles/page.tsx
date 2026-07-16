import { PageHeading } from "@/components/page-heading";
import { HelpCard } from "@/components/help/help-card";
import { HelpList, HelpSection } from "@/components/help/help-section";

export default function VehiclesHelpPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page Heading Block */}
      <PageHeading 
        eyebrow="Help" 
        title="Vehicles" 
        description="Track vehicles, ownership assets, and chronological service history." 
      />

      {/* Modern High-Contrast Strategy Guide Cards */}
      <section className="grid gap-4 md:grid-cols-3">
        <HelpCard 
          title="Purpose" 
          description="Identify the specific vehicle receiving service and securely connect it to its designated customer account." 
        />
        <HelpCard 
          title="Actions" 
          description="Search, view, create during intake, edit supported identity fields, and review complete historical service items." 
        />
        <HelpCard 
          title="Result" 
          description="The vehicle is permanently linked to repair orders and invoices to maintain a comprehensive shop service history." 
        />
      </section>

      {/* Main Documentation Block */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <HelpSection title="Vehicle entry">
          <HelpList items={[
            "Select an existing vehicle from the database immediately after choosing its designated customer account.",
            "For a brand new vehicle asset, enter the year, make, and model; optional stored parameters include license plate, VIN, and current odometer mileage.",
            "Smart suggestions pull from previous active shop entries, though flexible free-text typing remains fully available.",
            "Always verify and confirm correct active vehicle ownership configurations before finalizing and saving a new repair order."
          ]} />
        </HelpSection>
      </div>

      {/* High-Contrast Record Mutability Warning Panel */}
      <div className="rounded-2xl border border-red-100 bg-red-50/10 p-6 shadow-sm">
        <HelpSection title="Expectation" warning>
          <p className="text-sm leading-relaxed text-slate-600">
            Modifying or editing a vehicle record updates the cloud web directory asset only. To preserve absolute compliance and ledger integrity, historical invoice snapshots <strong className="font-semibold text-slate-900">remain completely immutable and unchanged</strong>.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
