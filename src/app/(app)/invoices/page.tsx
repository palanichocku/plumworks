import { EmptyState } from "@/components/empty-state";
import { PageHeading } from "@/components/page-heading";

export default function InvoicesPage() {
  return (
    <>
      <PageHeading
        eyebrow="Billing"
        title="Invoices"
        description="Review invoice history and account balances in one place."
      />
      <EmptyState
        title="No invoices to display"
        description="Invoice and balance information will be added in a later step."
      />
    </>
  );
}
