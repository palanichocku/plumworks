import { NewRepairOrderForm } from "@/components/new-repair-order-form";
import { PageHeading } from "@/components/page-heading";
import { getRepairOrderFormOptions, getRepairOrderPrefill } from "@/lib/data/repair-orders";

export const dynamic = "force-dynamic";

export default async function NewRepairOrderPage({ searchParams }: { searchParams: Promise<{ error?: string; customerId?: string; vehicleId?: string }> }) {
  const params = await searchParams;
  const [options, prefill] = await Promise.all([getRepairOrderFormOptions(), params.customerId ? getRepairOrderPrefill(params.customerId, params.vehicleId) : null]);
  const invalidPrefill = Boolean((params.customerId || params.vehicleId) && !prefill);
  return (
    <>
      <PageHeading eyebrow="Repair orders" title="New Repair Order" description="Select an existing customer or add a new customer with a new vehicle." />
      {(params.error || invalidPrefill) && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">The customer or vehicle information was invalid. Please review the form and try again.</p>}
      <NewRepairOrderForm {...options} initialCustomer={prefill?.customer ?? null} initialVehicleId={prefill?.vehicleId ?? null} />
    </>
  );
}
