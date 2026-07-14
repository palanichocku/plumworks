import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";

export default function VehiclesPage() {
  return (
    <>
      <PageHeading
        eyebrow="Inventory"
        title="Vehicles"
        description="View vehicle details and service history from the shop workspace."
      />
      <EmptyState
        title="No vehicles to display"
        description="Vehicle records and service history will be added in a later step."
      />
    </>
  );
}
