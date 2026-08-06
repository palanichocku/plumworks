import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceHistory } from "@/components/service-history";
import { getVehicleForCurrentShop } from "@/lib/data/vehicles";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { InternalNotesBlock } from "@/components/internal-notes-block";
import { updateVehicleNotes } from "../../internal-notes-actions";
import { canEditInternalNotes } from "@/lib/internal-notes";
import { RecordLifecycleActions } from "@/components/record-lifecycle-actions";
import { archiveVehicle, deleteVehiclePermanently, restoreVehicle } from "../../customer-vehicle-lifecycle-actions";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [vehicle, { membership }] = await Promise.all([getVehicleForCurrentShop(id), getCurrentMembership()]);

  if (!vehicle) {
    notFound();
  }

  const description =
    [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
    "Unnamed vehicle";
  const canEditNotes = Boolean(membership && hasPermission(membership.role, "edit_customer_vehicle") && canEditInternalNotes(membership.role));
  const canManageLifecycle = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const canDelete = membership?.role === "OWNER";
  const deleteBlockers = vehicle._count.repairOrders + vehicle._count.invoices + (vehicle.legacyCarno || vehicle.legacySourceTable ? 1 : 0);

  return (
    <>
      <Link
        href="/vehicles"
        className="text-sm font-semibold text-brand-primary hover:text-brand-primary"
      >
        ← Vehicles
      </Link>
      <header className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">
          Vehicle
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          {description}
        </h1>
        </div>
        <RecordLifecycleActions id={vehicle.id} archived={Boolean(vehicle.archivedAt)} canManage={canManageLifecycle} canDelete={Boolean(canDelete && deleteBlockers === 0)} archiveAction={archiveVehicle} restoreAction={restoreVehicle} deleteAction={deleteVehiclePermanently}>{!vehicle.archivedAt && !vehicle.customer.archivedAt ? <Link href={`/vehicles/${vehicle.id}/edit`} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Edit vehicle</Link> : null}</RecordLifecycleActions>
      </header>
      {vehicle.archivedAt || vehicle.customer.archivedAt ? <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Archived — {vehicle.archivedAt ? "this vehicle is archived" : "its customer is archived"} and it is unavailable for new Repair Orders.</div> : null}
      {canDelete && deleteBlockers > 0 ? <p className="mt-3 text-sm text-slate-600">Permanent deletion is unavailable: {vehicle._count.repairOrders} Repair Orders, {vehicle._count.invoices} Invoices{vehicle.legacyCarno || vehicle.legacySourceTable ? ", plus legacy lineage" : ""}.</p> : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Vehicle details
          </h2>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="text-slate-500">Engine</dt>
            <dd className="text-slate-900">Not imported yet</dd>
            <dt className="text-slate-500">VIN</dt>
            <dd className="min-w-0 break-all text-slate-900">
              {vehicle.vin ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">License</dt>
            <dd className="text-slate-900">
              {vehicle.licensePlate ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">Odometer</dt>
            <dd className="text-slate-900">{vehicle.odometer?.toLocaleString() ?? "Not recorded"}</dd>
            <dt className="text-slate-500">Legacy ID</dt>
            <dd className="text-slate-900">
              {vehicle.legacyCarno ?? "Not recorded"}
            </dd>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Customer</h2>
          <Link
            href={`/customers/${vehicle.customer.id}`}
            className="mt-5 block rounded-xl border border-slate-200 p-4 transition hover:border-brand-primary/30 hover:bg-brand-subtle"
          >
            <p className="font-semibold text-slate-950">
              {vehicle.customer.displayName}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {vehicle.customer.phone ?? "No phone"}
            </p>
            <p className="mt-1 truncate text-sm text-slate-600">
              {vehicle.customer.email ?? "No email"}
            </p>
          </Link>
        </article>
      </section>
      <InternalNotesBlock recordId={vehicle.id} notes={vehicle.notes} canEdit={canEditNotes} emptyMessage="No vehicle notes have been added." successMessage="Vehicle notes saved." action={updateVehicleNotes} />
      <ServiceHistory context="vehicle" contextId={vehicle.id} invoices={vehicle.invoices} repairOrders={vehicle.repairOrders} showCustomer />
    </>
  );
}
