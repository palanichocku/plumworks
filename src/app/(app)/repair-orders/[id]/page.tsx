import Link from "next/link";
import { notFound } from "next/navigation";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { formatDate, formatMoney } from "@/lib/formatters";
import { addLaborLine, addCannedServiceLaborLine, deleteLaborLine, updateLaborLine } from "../labor-actions";
import { addPartLineWithState, deletePartLine, updatePartLineWithState } from "../part-actions";
import { DeleteRepairOrderButton } from "@/components/delete-repair-order-button";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { EditableRepairOrderWorkspace } from "@/components/repair-order-concerns-form";
import { VendorCombobox } from "@/components/vendor-combobox";
import { PartActionForm } from "@/components/part-action-form";

type RepairOrder = NonNullable<Awaited<ReturnType<typeof getWebRepairOrderForCurrentShop>>>;
type LaborLine = RepairOrder["labor"][number];
type PartLine = RepairOrder["parts"][number];

export const dynamic = "force-dynamic";

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, { membership }] = await Promise.all([getWebRepairOrderForCurrentShop(id), getCurrentMembership()]);
  if (!order) notFound();
  const editable = order.status === "draft" || order.status === "open";
  const invoice = order.invoices[0];
  const canDelete = Boolean(membership && hasPermission(membership.role, "delete_draft_repair_order"));
  const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <header>
        <Link href="/repair-orders" className="text-sm font-semibold text-brand-primary">← Repair Orders</Link>
        <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-brand-primary">Repair Order / Estimate</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold text-slate-950">RO #{order.repairOrderNumber}</h1><span className="rounded-full bg-brand-subtle px-3 py-1 text-xs font-bold uppercase text-brand-primary">{order.status}</span></div>
          <div className="flex flex-wrap gap-3"><Link href={`/repair-orders/${order.id}/print`} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</Link>{invoice ? <Link href={`/invoices/${invoice.id}`} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary">{invoice.status === "open" ? "Open Invoice" : "View Invoice"}</Link> : editable && canDelete ? <DeleteRepairOrderButton repairOrderId={order.id} /> : null}</div>
        </div>
        <p className="mt-2 text-sm text-slate-600">Created {formatDate(order.openedAt)}</p>
        {!editable && <p className="mt-3 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Invoice created — this repair order is read-only</p>}
      </header>

      {editable ? <EditableRepairOrderWorkspace
        repairOrderId={order.id}
        customerComplaint={order.customerComplaint}
        recommendation={order.recommendation}
        overview={<OrderOverview order={order} vehicle={vehicle} />}
        parts={<PartsSection order={order} editable />}
        labor={<LaborSection order={order} editable />}
        totals={<TotalsSection order={order} />}
        createInvoiceHref={`/repair-orders/${order.id}/create-invoice`}
      /> : <RepairOrderWorkspace
        overview={<OrderOverview order={order} vehicle={vehicle} />}
        concerns={<ConcernsSection order={order} />}
        parts={<PartsSection order={order} editable={false} />}
        labor={<LaborSection order={order} editable={false} />}
        totals={<TotalsSection order={order} />}
        notes={<p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">An invoice exists for this repair order, so financial lines are read-only here.</p>}
      />}
    </div>
  );
}

function OrderOverview({ order, vehicle }: { order: RepairOrder; vehicle: string }) {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Customer</h2><Link href={`/customers/${order.customer.id}`} className="mt-3 block font-medium text-brand-primary">{order.customer.displayName}</Link></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Vehicle</h2><Link href={`/vehicles/${order.vehicle.id}`} className="mt-3 block font-medium text-brand-primary">{vehicle || "Vehicle details unavailable"}</Link></section></div>;
}

function ConcernsSection({ order }: { order: RepairOrder }) {
  if (!order.customerComplaint && !order.recommendation) return null;
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-base font-bold text-slate-950">Customer Concerns &amp; Recommendations</h2><div className="mt-5 grid gap-5 lg:grid-cols-2">{order.customerComplaint && <div><h3 className="text-sm font-semibold text-slate-700">Customer Complaint</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{order.customerComplaint}</p></div>}{order.recommendation && <div><h3 className="text-sm font-semibold text-slate-700">Service Recommendation</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{order.recommendation}</p></div>}</div></section>;
}

function PartsSection({ order, editable }: { order: RepairOrder; editable: boolean }) {
  const columns = "md:grid-cols-[minmax(12rem,1fr)_minmax(11rem,0.7fr)_7rem_8rem_auto]";
  return <fieldset disabled={!editable} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Parts</h2><p className="mt-1 text-sm text-slate-600">Amount is calculated from quantity × unit price.</p></div><p className="font-semibold text-slate-950">{formatMoney(order.partsTotal)}</p></div>{order.parts.length ? <div className="space-y-3">{order.parts.map((line: PartLine) => <PartActionForm key={line.id} action={updatePartLineWithState} className={`grid gap-3 rounded-xl border border-slate-200 p-4 ${columns} md:items-end`}><input type="hidden" name="repairOrderId" value={order.id} /><input type="hidden" name="partLineId" value={line.id} /><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} defaultValue={line.description} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><VendorCombobox vendors={order.shop.vendors} defaultVendor={line.vendor} /><label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={line.quantity.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" defaultValue={line.unitPrice.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><div className="flex gap-2"><FormSubmitButton pendingLabel="Updating…" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Update</FormSubmitButton><FormSubmitButton formAction={deletePartLine} pendingLabel="Deleting…" confirmMessage="Delete this part line?" className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</FormSubmitButton></div><p className="text-sm text-slate-600 md:col-start-4 md:text-right">Amount {formatMoney(Number(line.quantity) * Number(line.unitPrice))}</p></PartActionForm>)}</div> : <p className="text-sm text-slate-600">No parts added yet.</p>}<PartActionForm action={addPartLineWithState} className={`grid gap-3 border-t border-slate-200 pt-5 ${columns} md:items-end`}><input type="hidden" name="repairOrderId" value={order.id} /><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} placeholder="Part description" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><VendorCombobox vendors={order.shop.vendors} /><label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" defaultValue="1" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><FormSubmitButton pendingLabel="Adding…" className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary disabled:opacity-50">Add part</FormSubmitButton></PartActionForm></fieldset>;
}

function LaborSection({ order, editable }: { order: RepairOrder; editable: boolean }) {
  return <fieldset disabled={!editable} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Labor</h2><p className="mt-1 text-sm text-slate-600">Amount is calculated from hours × rate.</p></div><p className="font-semibold text-slate-950">{formatMoney(order.laborTotal)}</p></div>{order.shop.cannedServices.length > 0 && <form action={addCannedServiceLaborLine} className="flex flex-col gap-3 rounded-xl bg-brand-subtle p-4 sm:flex-row sm:items-end"><input type="hidden" name="repairOrderId" value={order.id} /><label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">Add common service<select name="serviceId" required defaultValue="" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="" disabled>Select a service</option>{order.shop.cannedServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><FormSubmitButton pendingLabel="Adding…" className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add service</FormSubmitButton></form>}{order.labor.length ? <div className="space-y-3">{order.labor.map((line: LaborLine) => <form key={line.id} action={updateLaborLine} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end"><input type="hidden" name="repairOrderId" value={order.id} /><input type="hidden" name="laborLineId" value={line.id} /><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} defaultValue={line.description} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" defaultValue={line.hours.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={line.hourlyRate.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><div className="flex gap-2"><FormSubmitButton pendingLabel="Updating…" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Update</FormSubmitButton><FormSubmitButton formAction={deleteLaborLine} pendingLabel="Deleting…" confirmMessage="Delete this labor line?" className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</FormSubmitButton></div><p className="text-sm text-slate-600 md:col-start-3 md:text-right">Amount {formatMoney(Number(line.hours) * Number(line.hourlyRate))}</p></form>)}</div> : <p className="text-sm text-slate-600">No labor added yet.</p>}<form action={addLaborLine} className="grid gap-3 border-t border-slate-200 pt-5 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end"><input type="hidden" name="repairOrderId" value={order.id} /><label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} placeholder="Labor description" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={order.shop.defaultLaborRate.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><FormSubmitButton pendingLabel="Adding…" className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary disabled:opacity-50">Add labor</FormSubmitButton></form></fieldset>;
}

function TotalsSection({ order }: { order: RepairOrder }) {
  return <section className="ml-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-slate-950">Repair Order Summary</h2><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-slate-600">Parts total</dt><dd className="font-medium text-slate-950">{formatMoney(order.partsTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Labor total</dt><dd className="font-medium text-slate-950">{formatMoney(order.laborTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-medium text-slate-950">{formatMoney(Number(order.partsTotal) + Number(order.laborTotal))}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Shop supplies</dt><dd className="font-medium text-slate-950">{formatMoney(order.shopSuppliesAmount)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Estimated tax</dt><dd className="font-medium text-slate-950">{formatMoney(order.taxTotal)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><dt>Estimated total</dt><dd>{formatMoney(order.estimatedTotal)}</dd></div></dl></section>;
}
