import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";

export default function CustomersPage() {
  return (
    <>
      <PageHeading
        eyebrow="Directory"
        title="Customers"
        description="Search and manage customer profiles from one workspace."
      />
      <EmptyState
        title="No customers to display"
        description="Customer search and profile records will be added in a later step."
      />
    </>
  );
}
