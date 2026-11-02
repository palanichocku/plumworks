import { NewRepairOrderForm } from "@/components/new-repair-order-form";
import { PageHeading } from "@/components/page-heading";
import { RepairOrderCheckInPreflight } from "@/components/repair-order-check-in-preflight";
import { getRepairOrderFormOptions, getRepairOrderPrefill } from "@/lib/data/repair-orders";

export const dynamic = "force-dynamic";

function errorMessage(error?: string) {
  if (error === "duplicate-vin") return "That VIN is already assigned to another active vehicle. Review the existing vehicle details below and correct the VIN or use the saved vehicle.";
  if (error === "archived-vin") return "That VIN belongs to an archived vehicle. Restore the existing customer/vehicle instead of creating a duplicate vehicle.";
  if (error) return "The customer or vehicle information was invalid. Please review the check-in and try again.";
  return null;
}

export default async function NewRepairOrderPage({ searchParams }: { searchParams: Promise<{ error?: string; customerId?: string; vehicleId?: string }> }) {
  const params = await searchParams;
  const [options, prefill] = await Promise.all([getRepairOrderFormOptions(), params.customerId ? getRepairOrderPrefill(params.customerId, params.vehicleId) : null]);
  const invalidPrefill = Boolean((params.customerId || params.vehicleId) && !prefill);
  const message = invalidPrefill ? "The customer or vehicle information was invalid. Please review the check-in and try again." : errorMessage(params.error);
  return (
    <>
      <PageHeading eyebrow="Repair orders" title="Vehicle Check-In" description="Identify the customer and vehicle, record mileage, and capture why the vehicle is here. Build the estimate after check-in." />
      {message && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>}
      <RepairOrderCheckInPreflight />
      <NewRepairOrderForm {...options} initialCustomer={prefill?.customer ?? null} initialVehicleId={prefill?.vehicleId ?? null} />
    </>
  );
}
