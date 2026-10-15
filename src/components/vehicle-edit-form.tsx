import Link from "next/link";

type VehicleEditValues = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  engine: string | null;
  licensePlate: string | null;
  vin: string | null;
  odometer: number | null;
};

type VehicleEditAction = (formData: FormData) => void | Promise<void>;

export function VehicleEditForm({
  vehicle,
  action,
  returnTo,
  cancelHref,
  embedded = false,
}: {
  vehicle: VehicleEditValues;
  action: VehicleEditAction;
  returnTo?: string;
  cancelHref?: string;
  embedded?: boolean;
}) {
  return <form action={action} className={embedded ? "grid gap-5 sm:grid-cols-2" : "mt-8 grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2"}>
    <input type="hidden" name="vehicleId" value={vehicle.id} />
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <label className="text-sm font-semibold text-slate-700">Year<input name="year" type="number" required min="1886" max={new Date().getFullYear() + 1} defaultValue={vehicle.year ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Make<input name="make" required maxLength={100} defaultValue={vehicle.make ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Model<input name="model" required maxLength={100} defaultValue={vehicle.model ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Engine<input name="engine" maxLength={100} placeholder="3.5L V6" defaultValue={vehicle.engine ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">License plate<input name="licensePlate" maxLength={30} defaultValue={vehicle.licensePlate ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700 sm:col-span-2">VIN<input name="vin" maxLength={50} defaultValue={vehicle.vin ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <label className="text-sm font-semibold text-slate-700">Odometer / mileage<input name="odometer" type="number" min="0" max="10000000" defaultValue={vehicle.odometer ?? ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
    <div className={embedded ? "sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-slate-200 bg-white px-1 pt-4 pb-1 sm:col-span-2" : "flex items-end gap-3 sm:col-span-2"}>
      <button type="submit" className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Save vehicle</button>
      {cancelHref ? <Link href={cancelHref} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link> : null}
    </div>
  </form>;
}
