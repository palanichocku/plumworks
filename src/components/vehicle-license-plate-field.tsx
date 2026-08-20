import { updateVehicleLicensePlate } from "@/app/(app)/vehicle-license-plate-actions";

export function VehicleLicensePlateField({
  vehicleId,
  licensePlate,
  context,
  contextId,
  editable,
}: {
  vehicleId: string;
  licensePlate: string | null;
  context: "vehicle" | "customer" | "repair-order";
  contextId: string;
  editable: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-500">License Plate</p>
      {editable ? (
        <form action={updateVehicleLicensePlate} className="mt-1.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <input type="hidden" name="context" value={context} />
          <input type="hidden" name="contextId" value={contextId} />
          <input name="licensePlate" maxLength={30} defaultValue={licensePlate ?? ""} aria-label="License Plate" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
          <button type="submit" className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-semibold text-brand-primary">Save</button>
        </form>
      ) : (
        <p className="mt-1.5 text-sm text-slate-900">{licensePlate ?? "Not recorded"}</p>
      )}
    </div>
  );
}
