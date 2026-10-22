import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepairOrderInternalNotesForCurrentShop, getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { getCustomerForEdit } from "@/lib/data/customers";
import { getVehicleForEdit } from "@/lib/data/vehicles";
import { formatDate, formatMoney } from "@/lib/formatters";
import { VoidRepairOrderButton } from "@/components/void-repair-order-button";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { EditableRepairOrderWorkspace } from "@/components/repair-order-concerns-form";
import { RepairOrderUnifiedLineItems } from "@/components/repair-order-unified-line-items";
import { EmailRepairOrderButton } from "@/components/email-repair-order-button";
import { normalizeEmailRecipient } from "@/lib/email/document-email-core";
import { RepairOrderInternalNotesPanel } from "@/components/repair-order-internal-notes-panel";
import { canEditInternalNotes } from "@/lib/internal-notes";
import { RepairOrderAssignmentActions } from "@/components/repair-order-assignment-dialog";
import { RepairOrderMileageField } from "@/components/repair-order-mileage-field";
import { getLastRecordedMileageForVehicle } from "@/lib/data/vehicle-mileage";
import { RepairOrderHistoryButton } from "@/components/repair-order-history-button";
import { repairOrderVoidReasonLabel } from "@/lib/repair-order-void";
import { RepairOrderAuthorizationPanel } from "@/components/repair-order-authorization-panel";
import { getRepairOrderAuthorizationHistory, getRepairOrderAuthorizationSummary } from "@/lib/authorization/repair-order-evidence";
import { EditRecordDialog } from "@/components/edit-record-dialog";
import { CustomerEditForm } from "@/components/customer-edit-form";
import { VehicleEditForm } from "@/components/vehicle-edit-form";
import { updateCustomer } from "@/app/(app)/customers/edit-actions";
import { updateVehicle } from "@/app/(app)/vehicles/edit-actions";

type RepairOrder = NonNullable<Awaited<ReturnType<typeof getWebRepairOrderForCurrentShop>>>;
type CustomerEditRecord = NonNullable<Awaited<ReturnType<typeof getCustomerForEdit>>>;
type VehicleEditRecord = NonNullable<Awaited<ReturnType<typeof getVehicleForEdit>>>;

export const dynamic = "force-dynamic";

const overviewActionClass = "shrink-0 px-1 py-2 text-sm font-semibold text-brand-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30";
const changeActionWrapperClass = "[&>button]:!border-0 [&>button]:!bg-transparent [&>button]:!px-1 [&>button]:!py-2 [&>button]:!text-[0px] [&>button]:!text-brand-primary [&>button]:!shadow-none [&>button]:!underline [&>button]:!underline-offset-4 [&>button:hover]:!bg-transparent [&>button:hover]:!text-brand-primary [&>button]:after:text-sm [&>button]:after:font-semibold [&>button]:after:underline [&>button]:after:underline-offset-4 [&>button]:after:content-['Change']";

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, internalNotes, { membership }] = await Promise.all([getWebRepairOrderForCurrentShop(id), getRepairOrderInternalNotesForCurrentShop(id), getCurrentMembership()]);
  if (!order || !internalNotes || internalNotes.vehicle.customerId !== internalNotes.customer.id) notFound();
  const editable = order.status === "draft" || order.status === "open";
  const invoice = order.invoices[0];
  const canEditCustomerVehicle = Boolean(membership && hasPermission(membership.role, "edit_customer_vehicle") && editable && !invoice);
  const [lastMileage, authorizationSummary, authorizationHistory, customerForEdit, vehicleForEdit] = await Promise.all([
    membership ? getLastRecordedMileageForVehicle(membership.shopId, order.vehicle.id) : null,
    getRepairOrderAuthorizationSummary(id),
    getRepairOrderAuthorizationHistory(id),
    canEditCustomerVehicle ? getCustomerForEdit(order.customer.id) : null,
    canEditCustomerVehicle ? getVehicleForEdit(order.vehicle.id) : null,
  ]);
  const canVoid = Boolean(membership && hasPermission(membership.role, "void_repair_order") && editable && order.repairOrderNumber !== null && !invoice);
  const canEditNotes = Boolean(order.status !== "void" && membership && hasPermission(membership.role, "edit_customer_vehicle") && canEditInternalNotes(membership.role));
  const canCorrectAssignment = Boolean(membership && hasPermission(membership.role, "edit_draft_repair_order") && editable && !invoice);
  const canOverrideAuthorization = Boolean(membership && (membership.role === "OWNER" || membership.role === "ADMIN"));
  const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <header>
        <Link href="/repair-orders" className="text-sm font-semibold text-brand-primary">← Repair Orders</Link>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-3xl font-bold text-slate-950">RO #{order.repairOrderNumber}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${order.status === "void" ? "border border-red-300 bg-red-100 text-red-800" : "bg-brand-subtle text-brand-primary"}`}>{order.status}</span>
          <span className="text-sm font-medium text-slate-600">Estimate · Created {formatDate(order.openedAt)}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <EmailRepairOrderButton repairOrderId={order.id} defaultRecipient={normalizeEmailRecipient(order.customer.email ?? "") ?? ""} status={order.status} printHref={`/repair-orders/${order.id}/print`} />
            {invoice ? <Link href={`/invoices/${invoice.id}`} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary">{invoice.status === "open" ? "Open Invoice" : "View Invoice"}</Link> : canVoid ? <details className="relative"><summary aria-label="More Repair Order actions" className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-bold leading-none text-slate-700 hover:border-brand-primary hover:text-brand-primary">•••</summary><div className="absolute right-0 z-20 mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"><VoidRepairOrderButton repairOrderId={order.id} repairOrderNumber={String(order.repairOrderNumber)} compact /></div></details> : null}
          </div>
        </div>
        {order.status === "void" ? <section className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950"><h2 className="font-bold">This repair order was voided and is retained for audit history.</h2><dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]"><dt className="font-semibold">Void reason</dt><dd>{repairOrderVoidReasonLabel(order.voidReason)}</dd>{order.voidNote ? <><dt className="font-semibold">Explanation</dt><dd className="whitespace-pre-wrap">{order.voidNote}</dd></> : null}<dt className="font-semibold">Voided</dt><dd>{formatDate(order.voidedAt)}</dd></dl></section> : !editable ? <p className="mt-3 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Invoice created — this repair order is read-only</p> : null}
      </header>

      {authorizationSummary ? <RepairOrderAuthorizationPanel
        repairOrderId={order.id}
        estimatedTotal={Number(order.estimatedTotal).toFixed(2)}
        editable={editable && !invoice}
        summary={{
          status: authorizationSummary.status,
          approvedRevision: authorizationSummary.approvedRevision,
          approvedAt: authorizationSummary.approvedAt?.toISOString() ?? null,
          authorizerName: authorizationSummary.authorizerName,
        }}
        history={authorizationHistory.map((item) => ({ ...item, occurredAt: item.occurredAt.toISOString() }))}
      /> : null}

      {editable ? <EditableRepairOrderWorkspace
        repairOrderId={order.id}
        customerComplaint={order.customerComplaint}
        recommendation={order.recommendation}
        estimatedTotal={Number(order.estimatedTotal).toFixed(2)}
        authorizationStatus={authorizationSummary?.status ?? "NOT_AUTHORIZED"}
        canOverrideAuthorization={canOverrideAuthorization}
        overview={<OrderOverview order={order} vehicle={vehicle} customerForEdit={customerForEdit} vehicleForEdit={vehicleForEdit} canEditCustomerVehicle={canEditCustomerVehicle} canCorrectAssignment={canCorrectAssignment} lastMileage={lastMileage} />}
        parts={<LineItemsSection order={order} editable />}
        labor={null}
        totals={<TotalsSection order={order} />}
        notes={<RepairOrderInternalNotesPanel customer={internalNotes.customer} vehicle={internalNotes.vehicle} canEdit={canEditNotes} />}
      /> : <RepairOrderWorkspace
        overview={<OrderOverview order={order} vehicle={vehicle} customerForEdit={null} vehicleForEdit={null} canEditCustomerVehicle={false} canCorrectAssignment={false} lastMileage={lastMileage} />}
        concerns={<ConcernsSection order={order} />}
        parts={<LineItemsSection order={order} editable={false} />}
        labor={null}
        totals={<TotalsSection order={order} />}
        notes={<><RepairOrderInternalNotesPanel customer={internalNotes.customer} vehicle={internalNotes.vehicle} canEdit={canEditNotes} />{order.status === "void" ? null : <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">An invoice exists for this repair order, so financial lines are read-only here.</p>}</>}
      />}
    </div>
  );
}

function OrderOverview({ order, vehicle, customerForEdit, vehicleForEdit, canEditCustomerVehicle, canCorrectAssignment, lastMileage }: { order: RepairOrder; vehicle: string; customerForEdit: CustomerEditRecord | null; vehicleForEdit: VehicleEditRecord | null; canEditCustomerVehicle: boolean; canCorrectAssignment: boolean; lastMileage: { mileage: number; recordedAt: Date } | null }) {
  const locality = [order.customer.city, order.customer.state, order.customer.postalCode].filter(Boolean).join(", ");
  const assignment = { customerId: order.customer.id, customerName: order.customer.displayName, vehicleId: order.vehicle.id, vehicleName: vehicle || "Vehicle details unavailable" };
  const returnTo = `/repair-orders/${order.id}`;
  const displayedMileage = lastMileage
    ? { mileage: lastMileage.mileage, source: `last invoice · ${formatDate(lastMileage.recordedAt)}` }
    : order.vehicle.odometer !== null
      ? { mileage: order.vehicle.odometer, source: "vehicle record" }
      : null;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="grid md:grid-cols-2">
      <div className="min-w-0 p-5 md:border-r md:border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="ro-section-heading">Customer</h2><div className="flex flex-wrap items-center justify-end gap-2"><RepairOrderHistoryButton customerId={order.customer.id} vehicleId={order.vehicle.id} vehicleLabel={vehicle || "Vehicle details unavailable"} currentRepairOrderId={order.id} className={overviewActionClass} />{canEditCustomerVehicle && customerForEdit ? <EditRecordDialog triggerLabel="Edit" triggerClassName={overviewActionClass} title="Edit customer" description="Update this customer's master record without leaving the Repair Order."><CustomerEditForm customer={customerForEdit} action={updateCustomer} returnTo={returnTo} embedded /></EditRecordDialog> : null}{canCorrectAssignment ? <span className={changeActionWrapperClass}><RepairOrderAssignmentActions repairOrderId={order.id} current={assignment} triggerMode="customer" /></span> : null}</div></div>
        <Link href={`/customers/${order.customer.id}`} className="mt-3 block font-medium text-brand-primary">{order.customer.displayName}</Link>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-slate-500">Phone</dt><dd className="text-slate-800">{order.customer.phone ?? "Not recorded"}</dd><dt className="text-slate-500">Email</dt><dd className="min-w-0 break-all text-slate-800">{order.customer.email ?? "Not recorded"}</dd><dt className="text-slate-500">Address</dt><dd className="text-slate-800">{[order.customer.addressLine1, order.customer.addressLine2, locality].filter(Boolean).join(" · ") || "Not recorded"}</dd></dl>
      </div>
      <div className="min-w-0 border-t border-slate-200 p-5 md:border-t-0">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="ro-section-heading">Vehicle</h2><div className="flex flex-wrap items-center justify-end gap-2">{canEditCustomerVehicle && vehicleForEdit ? <EditRecordDialog triggerLabel="Edit" triggerClassName={overviewActionClass} title="Edit vehicle" description="Update this vehicle's master record. Current mileage for this service visit remains recorded separately on the Repair Order."><VehicleEditForm vehicle={vehicleForEdit} action={updateVehicle} returnTo={returnTo} embedded /></EditRecordDialog> : null}{canCorrectAssignment ? <span className={changeActionWrapperClass}><RepairOrderAssignmentActions repairOrderId={order.id} current={assignment} triggerMode="vehicle" /></span> : null}</div></div>
        <Link href={`/vehicles/${order.vehicle.id}`} className="mt-3 block font-medium text-brand-primary">{vehicle || "Vehicle details unavailable"}</Link>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"><dt className="text-slate-500">License plate</dt><dd className="text-slate-800">{order.vehicle.licensePlate ?? "Not recorded"}</dd><dt className="text-slate-500">VIN</dt><dd className="min-w-0 break-all text-slate-800">{order.vehicle.vin ?? "Not recorded"}</dd><dt className="text-slate-500">Last recorded mileage</dt><dd className="text-slate-800">{displayedMileage ? <>{displayedMileage.mileage.toLocaleString()} <span className="text-xs text-slate-500">({displayedMileage.source})</span></> : "Not recorded"}</dd><dt className="text-slate-500">Engine</dt><dd className="font-semibold text-slate-900">{order.vehicle.engine ?? "Not recorded"}</dd></dl>
        {canCorrectAssignment ? <RepairOrderMileageField repairOrderId={order.id} mileage={order.odometer} /> : <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt className="text-slate-500">Current mileage</dt><dd className="text-slate-800">{order.odometer?.toLocaleString() ?? "Not recorded"}</dd></dl>}
      </div>
    </div>
  </section>;
}

function ConcernsSection({ order }: { order: RepairOrder }) {
  if (!order.customerComplaint && !order.recommendation) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="ro-section-heading">Customer Concerns &amp; Recommendations</h2><div className="mt-5 grid gap-5 lg:grid-cols-2">{order.customerComplaint && <div><h3 className="text-sm font-semibold text-slate-700">Customer Complaint</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{order.customerComplaint}</p></div>}{order.recommendation && <div><h3 className="text-sm font-semibold text-slate-700">Service Recommendation</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{order.recommendation}</p></div>}</div></section>;
}

function LineItemsSection({ order, editable }: { order: RepairOrder; editable: boolean }) {
  const ordinaryLabor = order.labor.filter((line) => !line.complimentary);
  const complimentaryLabor = order.labor.filter((line) => line.complimentary);
  return <RepairOrderUnifiedLineItems
    repairOrderId={order.id}
    partsTotal={order.partsTotal.toString()}
    laborTotal={order.laborTotal.toString()}
    parts={order.parts.map((line) => ({ ...line, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString() }))}
    labor={ordinaryLabor.map((line) => ({ ...line, hours: line.hours.toString(), hourlyRate: line.hourlyRate.toString() }))}
    complimentary={complimentaryLabor.map(({ id, description }) => ({ id, description }))}
    vendors={order.shop.vendors}
    services={order.shop.cannedServices.map((service) => ({ ...service, defaultHours: service.defaultHours.toString(), defaultLaborRate: service.defaultLaborRate.toString() }))}
    defaultRate={order.shop.defaultLaborRate.toString()}
    editable={editable}
  />;
}

function TotalsSection({ order }: { order: RepairOrder }) {
  return <section className="ml-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="ro-section-heading mb-4">Repair Order Summary</h2><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-slate-600">Parts total</dt><dd className="font-medium text-slate-950">{formatMoney(order.partsTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Labor total</dt><dd className="font-medium text-slate-950">{formatMoney(order.laborTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-medium text-slate-950">{formatMoney(Number(order.partsTotal) + Number(order.laborTotal))}</dd></div>{order.shopSuppliesEnabledSnapshot && <div><div className="flex justify-between"><dt className="text-slate-600">Shop supplies</dt><dd className="font-medium text-slate-950">{formatMoney(order.shopSuppliesAmount)}</dd></div><p className="mt-1 text-xs text-slate-500">{order.shopSuppliesRateSnapshot.mul(100).toString()}% of labor, maximum {formatMoney(order.shopSuppliesCapSnapshot)}</p></div>}<div className="flex justify-between"><dt className="text-slate-600">Estimated tax</dt><dd className="font-medium text-slate-950">{formatMoney(order.taxTotal)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><dt>Estimated total</dt><dd>{formatMoney(order.estimatedTotal)}</dd></div></dl></section>;
}