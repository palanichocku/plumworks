import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceHistory } from "@/components/service-history";
import { getCustomerForCurrentShop } from "@/lib/data/customers";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { InternalNotesBlock } from "@/components/internal-notes-block";
import { updateCustomerNotes } from "../../internal-notes-actions";
import { canEditInternalNotes } from "@/lib/internal-notes";
import { RecordLifecycleActions } from "@/components/record-lifecycle-actions";
import { archiveCustomer, deleteCustomerPermanently, restoreCustomer } from "../../customer-vehicle-lifecycle-actions";

type CustomerDetail = NonNullable<
  Awaited<ReturnType<typeof getCustomerForCurrentShop>>
>;
type CustomerVehicle = CustomerDetail["vehicles"][number];

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [customer, { membership }] = await Promise.all([getCustomerForCurrentShop(id), getCurrentMembership()]);

  if (!customer) {
    notFound();
  }
  const canEditNotes = Boolean(membership && hasPermission(membership.role, "edit_customer_vehicle") && canEditInternalNotes(membership.role));
  const canManageLifecycle = membership?.role === "OWNER" || membership?.role === "ADMIN";
  const canDelete = membership?.role === "OWNER";
  const deleteBlockers = Object.values(customer._count).reduce((sum, count) => sum + count, 0) + (customer.legacyCustno || customer.legacySourceTable ? 1 : 0);
  const activeVehicles = customer.vehicles.filter((vehicle) => !vehicle.archivedAt);

  return (
    <>
      <Link
        href="/customers"
        className="text-sm font-semibold text-brand-primary hover:text-brand-primary"
      >
        ← Customers
      </Link>
      <header className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">
          Customer
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          {customer.displayName}
        </h1>
        </div>
        <RecordLifecycleActions id={customer.id} archived={Boolean(customer.archivedAt)} canManage={canManageLifecycle} canDelete={Boolean(canDelete && deleteBlockers === 0)} archiveAction={archiveCustomer} restoreAction={restoreCustomer} deleteAction={deleteCustomerPermanently}>{!customer.archivedAt ? <><Link href={activeVehicles.length === 1 ? `/repair-orders/new?customerId=${customer.id}&vehicleId=${activeVehicles[0].id}` : "#customer-repair-order"} className="rounded-lg border border-brand-primary px-4 py-2.5 text-sm font-semibold text-brand-primary">Create Repair Order</Link><Link href={`/customers/${customer.id}/edit`} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Edit customer</Link></> : null}</RecordLifecycleActions>
      </header>
      {customer.archivedAt ? <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Archived — retained for historical lookup and unavailable for new Repair Orders.</div> : null}
      {canDelete && deleteBlockers > 0 ? <p className="mt-3 text-sm text-slate-600">Permanent deletion is unavailable: {customer._count.vehicles} Vehicles, {customer._count.repairOrders} Repair Orders, {customer._count.invoices} Invoices, {customer._count.payments} Payments, {customer._count.accountsReceivable} Accounts Receivable records{customer.legacyCustno || customer.legacySourceTable || customer._count.legacyAliases ? ", plus legacy lineage" : ""}.</p> : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Contact details
          </h2>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="text-slate-500">Primary phone</dt>
            <dd className="text-slate-900">{customer.phone ? <a href={`tel:${customer.phone.replaceAll(/\D/g, "")}`} className="hover:text-brand-primary">{customer.phone}</a> : "Not recorded"}</dd>
            {customer.phone2 ? <><dt className="text-slate-500">Additional phone</dt><dd className="text-slate-900"><a href={`tel:${customer.phone2.replaceAll(/\D/g, "")}`} className="hover:text-brand-primary">{customer.phone2}</a></dd></> : null}
            <dt className="text-slate-500">Email</dt>
            <dd className="min-w-0 truncate text-slate-900">
              {customer.email ?? "Not recorded"}
            </dd>
            <dt className="text-slate-500">Legacy ID</dt>
            <dd className="text-slate-900">
              {customer.legacyCustno ?? "Not recorded"}
            </dd>
          </dl>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Address</h2>
          <p className="mt-5 text-sm leading-6 text-slate-600">
            {customer.addressLine1 ?? "Not recorded"}<br />
            {[customer.city, customer.state, customer.postalCode]
              .filter(Boolean)
              .join(", ") || "City and state not recorded"}
          </p>
        </article>
      </section>

      <InternalNotesBlock recordId={customer.id} notes={customer.notes} canEdit={canEditNotes} emptyMessage="No customer notes have been added." successMessage="Customer notes saved." action={updateCustomerNotes} />

      {!customer.archivedAt && activeVehicles.length !== 1 ? <section id="customer-repair-order" className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">Create Repair Order</h2>{activeVehicles.length ? <form action="/repair-orders/new" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><input type="hidden" name="customerId" value={customer.id} /><label className="flex-1 text-sm font-semibold text-slate-700">Vehicle<select name="vehicleId" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">{activeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable"}{vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : ""}</option>)}</select></label><button className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Continue</button></form> : <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600"><span>Add an active Vehicle before creating a Repair Order.</span><Link href={`/vehicles/new?customerId=${customer.id}`} className="font-semibold text-brand-primary">Add Vehicle</Link></div>}</section> : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">Vehicles</h2>{!customer.archivedAt ? <Link href={`/vehicles/new?customerId=${customer.id}`} className="text-sm font-semibold text-brand-primary">+ Add Vehicle</Link> : null}</div>
        </div>
        {customer.vehicles.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-600">
            No vehicles are linked to this customer.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {customer.vehicles.map((vehicle: CustomerVehicle) => (
              <li key={vehicle.id}>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-950">
                    {[vehicle.year, vehicle.make, vehicle.model]
                      .filter(Boolean)
                      .join(" ") || "Unnamed vehicle"} {vehicle.archivedAt ? <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Archived</span> : null}
                  </span>
                  <span className="text-sm text-slate-500">
                    {vehicle.licensePlate ?? "No plate"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ServiceHistory context="customer" contextId={customer.id} invoices={customer.invoices} repairOrders={customer.repairOrders} showVehicle />
    </>
  );
}
