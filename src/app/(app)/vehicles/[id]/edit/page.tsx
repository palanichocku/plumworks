import Link from "next/link";
import { notFound } from "next/navigation";
import { getVehicleForEdit } from "@/lib/data/vehicles";
import { updateVehicle } from "../../edit-actions";

export const dynamic = "force-dynamic";

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = await getVehicleForEdit(id);
  if (!vehicle) notFound();

  return <div className="mx-auto max-w-3xl">
    <Link href={`/vehicles/${vehicle.id}`} className="text-sm font-semibold text-brand-primary">← Vehicle details</Link>
    <header className="mt-5"><p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Vehicle</p><h1 className="mt-2 text-3xl font-bold text-slate-950">Edit vehicle</h1></header>
    <form action={updateVehicle} className="mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2">
      <input type="hidden" name="vehicleId" value={vehicle.id} />
      <label className="text-sm font-semibold text-slate-700">Year<input name="year" type="number" required min="1886" max={new Date().getFullYear() + 1} defaultValue={vehicle.year ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Make<input name="make" required maxLength={100} defaultValue={vehicle.make ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Model<input name="model" required maxLength={100} defaultValue={vehicle.model ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">License plate<input name="licensePlate" maxLength={30} defaultValue={vehicle.licensePlate ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700 sm:col-span-2">VIN<input name="vin" maxLength={50} defaultValue={vehicle.vin ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">Odometer / mileage<input name="odometer" type="number" min="0" max="10000000" defaultValue={vehicle.odometer ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
      <div className="flex items-end gap-3 sm:col-span-2"><button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Save vehicle</button><Link href={`/vehicles/${vehicle.id}`} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link></div>
    </form>
  </div>;
}
