import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpenOrderForCurrentShop } from "@/lib/data/open-orders";
import { formatDate, formatMoney } from "@/lib/formatters";

type OpenOrder = NonNullable<Awaited<ReturnType<typeof getOpenOrderForCurrentShop>>>;
type PartLine = OpenOrder["parts"][number];
type LaborLine = OpenOrder["labor"][number];

export const dynamic = "force-dynamic";

export default async function OpenOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOpenOrderForCurrentShop(id);
  if (!order) notFound();
  const vehicle = [order.vehicle.year, order.vehicle.make, order.vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <header>
        <Link href="/repair-orders" className="text-sm font-semibold text-brand-primary hover:text-brand-primary">← Repair Orders</Link>
        <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-brand-primary">Repair Order / Estimate</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight text-slate-950">RO #{order.legacyRoNo ?? "Not recorded"}</h1>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">Open · read-only legacy order</span></div>
          <Link href={`/open-orders/${order.id}/print`} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary">Print</Link>
        </div>
        <p className="mt-2 text-sm text-slate-600">Opened {formatDate(order.openedAt)}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Customer</h2><Link href={`/customers/${order.customer.id}`} className="mt-3 block font-medium text-brand-primary">{order.customer.displayName}</Link><p className="mt-1 text-sm text-slate-600">{order.customer.phone ?? "Phone not imported yet"}</p></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Vehicle</h2><Link href={`/vehicles/${order.vehicle.id}`} className="mt-3 block font-medium text-brand-primary">{vehicle || "Vehicle details unavailable"}</Link><p className="mt-1 text-sm text-slate-600">Mileage {order.odometer?.toLocaleString() ?? "not available"}</p></section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><h2 className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-950">Parts</h2>{order.parts.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Description</th><th className="px-5 py-3">Part #</th><th className="px-5 py-3 text-right">Qty</th><th className="px-5 py-3 text-right">Price</th></tr></thead><tbody className="divide-y divide-slate-200">{order.parts.map((part: PartLine) => <tr key={part.id}><td className="px-5 py-3 text-slate-900">{part.description}</td><td className="px-5 py-3 text-slate-600">{part.partNumber ?? "—"}</td><td className="px-5 py-3 text-right text-slate-600">{part.quantity.toString()}</td><td className="px-5 py-3 text-right text-slate-900">{formatMoney(part.unitPrice)}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-slate-600">No parts recorded.</p>}</section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><h2 className="border-b border-slate-200 px-5 py-4 font-semibold text-slate-950">Labor</h2>{order.labor.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Description</th><th className="px-5 py-3 text-right">Hours</th><th className="px-5 py-3 text-right">Rate</th></tr></thead><tbody className="divide-y divide-slate-200">{order.labor.map((labor: LaborLine) => <tr key={labor.id}><td className="px-5 py-3 text-slate-900">{labor.description}</td><td className="px-5 py-3 text-right text-slate-600">{labor.hours.toString()}</td><td className="px-5 py-3 text-right text-slate-900">{formatMoney(labor.hourlyRate)}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-slate-600">No labor recorded.</p>}</section>

      <section className="ml-auto max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt>Parts</dt><dd>{formatMoney(order.partsTotal)}</dd></div><div className="flex justify-between"><dt>Labor</dt><dd>{formatMoney(order.laborTotal)}</dd></div><div className="flex justify-between"><dt>Estimated tax</dt><dd>{formatMoney(order.taxTotal)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><dt>Estimated total</dt><dd>{formatMoney(order.estimatedTotal)}</dd></div></dl></section>
    </div>
  );
}
