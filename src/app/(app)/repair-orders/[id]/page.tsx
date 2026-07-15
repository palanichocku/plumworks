import Link from "next/link";
import { notFound } from "next/navigation";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { formatDate, formatMoney } from "@/lib/formatters";
import {
  addLaborLine,
  addCannedServiceLaborLine,
  deleteLaborLine,
  updateLaborLine,
} from "../labor-actions";
import {
  addPartLine,
  deletePartLine,
  updatePartLine,
} from "../part-actions";
import { DeleteRepairOrderButton } from "@/components/delete-repair-order-button";

type RepairOrder = NonNullable<
  Awaited<ReturnType<typeof getWebRepairOrderForCurrentShop>>
>;
type LaborLine = RepairOrder["labor"][number];
type PartLine = RepairOrder["parts"][number];

export const dynamic = "force-dynamic";

export default async function RepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getWebRepairOrderForCurrentShop(id);
  if (!order) notFound();
  const editable = order.status === "draft" || order.status === "open";
  const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ");

  return <div className="space-y-6">
    <header><Link href="/repair-orders" className="text-sm font-semibold text-sky-700">← Repair Orders</Link><p className="mt-5 text-sm font-semibold uppercase tracking-wider text-sky-700">Repair Order / Estimate</p><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold text-slate-950">RO #{order.repairOrderNumber}</h1><span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold uppercase text-sky-800">{order.status}</span></div><div className="flex flex-wrap gap-3"><Link href={`/repair-orders/${order.id}/print`} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Print</Link>{editable && <><Link href={`/repair-orders/${order.id}/finalize`} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700">Finalize / Create Invoice</Link><DeleteRepairOrderButton repairOrderId={order.id} /></>}</div></div><p className="mt-2 text-sm text-slate-600">Created {formatDate(order.openedAt)}</p>{!editable && <p className="mt-3 rounded-lg bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Finalized repair order — read-only</p>}</header>
    <div className="grid gap-4 md:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Customer</h2><Link href={`/customers/${order.customer.id}`} className="mt-3 block font-medium text-sky-700">{order.customer.displayName}</Link></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Vehicle</h2><Link href={`/vehicles/${order.vehicle.id}`} className="mt-3 block font-medium text-sky-700">{vehicle || "Vehicle details unavailable"}</Link></section></div>
    <fieldset disabled={!editable} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75">
      <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Parts</h2><p className="mt-1 text-sm text-slate-600">Amount is calculated from quantity × unit price.</p></div><p className="font-semibold text-slate-950">{formatMoney(order.partsTotal)}</p></div>
      {order.parts.length ? <div className="space-y-3">{order.parts.map((line: PartLine) => <form key={line.id} action={updatePartLine} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end">
        <input type="hidden" name="repairOrderId" value={order.id} /><input type="hidden" name="partLineId" value={line.id} />
        <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} defaultValue={line.description} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={line.quantity.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" defaultValue={line.unitPrice.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <div className="flex gap-2"><button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">Update</button><button type="submit" formAction={deletePartLine} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete</button></div>
        <p className="text-sm text-slate-600 md:col-start-3 md:text-right">Amount {formatMoney(Number(line.quantity) * Number(line.unitPrice))}</p>
      </form>)}</div> : <p className="text-sm text-slate-600">No parts added yet.</p>}
      <form action={addPartLine} className="grid gap-3 border-t border-slate-200 pt-5 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end">
        <input type="hidden" name="repairOrderId" value={order.id} />
        <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} placeholder="Part description" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Quantity<input name="quantity" type="number" required min="0.01" max="1000000" step="0.01" defaultValue="1" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Unit price<input name="unitPrice" type="number" required min="0" max="1000000" step="0.01" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Add part</button>
      </form>
    </fieldset>
    <fieldset disabled={!editable} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm disabled:bg-slate-50 disabled:opacity-75">
      <div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">Labor</h2><p className="mt-1 text-sm text-slate-600">Amount is calculated from hours × rate.</p></div><p className="font-semibold text-slate-950">{formatMoney(order.laborTotal)}</p></div>
      {order.shop.cannedServices.length > 0 && <form action={addCannedServiceLaborLine} className="flex flex-col gap-3 rounded-xl bg-sky-50 p-4 sm:flex-row sm:items-end"><input type="hidden" name="repairOrderId" value={order.id} /><label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">Add common service<select name="serviceId" required defaultValue="" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="" disabled>Select a service</option>{order.shop.cannedServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white">Add service</button></form>}
      {order.labor.length ? <div className="space-y-3">{order.labor.map((line: LaborLine) => <form key={line.id} action={updateLaborLine} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end">
        <input type="hidden" name="repairOrderId" value={order.id} /><input type="hidden" name="laborLineId" value={line.id} />
        <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} defaultValue={line.description} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" defaultValue={line.hours.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={line.hourlyRate.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <div className="flex gap-2"><button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">Update</button><button type="submit" formAction={deleteLaborLine} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete</button></div>
        <p className="text-sm text-slate-600 md:col-start-3 md:text-right">Amount {formatMoney(Number(line.hours) * Number(line.hourlyRate))}</p>
      </form>)}</div> : <p className="text-sm text-slate-600">No labor added yet.</p>}
      <form action={addLaborLine} className="grid gap-3 border-t border-slate-200 pt-5 md:grid-cols-[1fr_7rem_8rem_auto] md:items-end">
        <input type="hidden" name="repairOrderId" value={order.id} />
        <label className="text-sm font-semibold text-slate-700">Description<input name="description" required maxLength={500} placeholder="Labor description" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Hours<input name="hours" type="number" required min="0.01" max="1000" step="0.01" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <label className="text-sm font-semibold text-slate-700">Rate<input name="hourlyRate" type="number" required min="0" max="1000000" step="0.01" defaultValue={order.shop.defaultLaborRate.toString()} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
        <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Add labor</button>
      </form>
    </fieldset>
    <section className="ml-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-slate-600">Parts total</dt><dd className="font-medium text-slate-950">{formatMoney(order.partsTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Labor total</dt><dd className="font-medium text-slate-950">{formatMoney(order.laborTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-medium text-slate-950">{formatMoney(Number(order.partsTotal) + Number(order.laborTotal))}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Estimated tax</dt><dd className="font-medium text-slate-950">{formatMoney(order.taxTotal)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><dt>Estimated total</dt><dd>{formatMoney(order.estimatedTotal)}</dd></div></dl></section>
    <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{editable ? "Finalization creates an invoice and makes this repair order read-only. Payment is collected separately." : "This repair order has been finalized and is read-only."}</p>
  </div>;
}
