import Link from "next/link";
import { notFound } from "next/navigation";
import { getVehicleForEdit } from "@/lib/data/vehicles";
import { updateVehicle } from "../../edit-actions";
import { VehicleEditForm } from "@/components/vehicle-edit-form";

export const dynamic = "force-dynamic";

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = await getVehicleForEdit(id);
  if (!vehicle) notFound();

  return <div className="mx-auto max-w-3xl">
    <Link href={`/vehicles/${vehicle.id}`} className="text-sm font-semibold text-brand-primary">← Vehicle details</Link>
    <header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Vehicle</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Edit vehicle</h1></header>
    <VehicleEditForm vehicle={vehicle} action={updateVehicle} cancelHref={`/vehicles/${vehicle.id}`} />
  </div>;
}
