import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getOpenOrdersForCurrentShop } from "@/lib/data/open-orders";
import { formatDate, formatMoney } from "@/lib/formatters";
import { DeleteRepairOrderButton } from "@/components/delete-repair-order-button";

type RepairOrder = Awaited<
  ReturnType<typeof getOpenOrdersForCurrentShop>
>[number];

export const dynamic = "force-dynamic";

export default async function RepairOrdersPage() {
  const orders = await getOpenOrdersForCurrentShop();

  return <>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <PageHeading eyebrow="Work in progress" title="Repair Orders" description="Draft and open repair orders that have not been finalized as invoices." />
      <Link href="/repair-orders/new" className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">New Repair Order</Link>
    </div>
    {orders.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm"><h2 className="text-xl font-semibold text-slate-950">No repair orders</h2><p className="mt-2 text-sm text-slate-600">Draft and open work for this shop will appear here.</p></section> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><ul className="divide-y divide-slate-200">{orders.map((order: RepairOrder) => {
      const imported = Boolean(order.legacySourceTable);
      const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
      return <li key={order.id} className="flex items-center pr-3 hover:bg-slate-50"><Link href={imported ? `/open-orders/${order.id}` : `/repair-orders/${order.id}`} className="grid min-w-0 flex-1 gap-2 px-5 py-4 md:grid-cols-[0.9fr_1.2fr_1.2fr_1fr_0.8fr] md:items-center"><span><span className="block font-semibold text-slate-950">RO #{order.repairOrderNumber ?? order.legacyRoNo ?? "Not recorded"}</span><span className="text-sm text-slate-500">{formatDate(order.openedAt)}</span></span><span className="truncate text-sm text-slate-700">{order.customer.displayName}</span><span className="truncate text-sm text-slate-600">{vehicle}</span><span><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${imported ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{order.status}{imported ? " · read-only" : ""}</span><span className="mt-1 block text-xs text-slate-500">{order._count.parts} parts · {order._count.labor} labor</span></span><span className="text-sm font-medium text-slate-900">{formatMoney(order.estimatedTotal)}</span></Link>{!imported && <DeleteRepairOrderButton repairOrderId={order.id} compact />}</li>;
    })}</ul></section>}
  </>;
}
