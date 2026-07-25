import Link from "next/link";
import { notFound } from "next/navigation";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { formatDate, formatMoney } from "@/lib/formatters";
import { DeleteRepairOrderButton } from "@/components/delete-repair-order-button";
import { RepairOrderWorkspace } from "@/components/repair-order-workspace";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { EditableRepairOrderWorkspace } from "@/components/repair-order-concerns-form";
import { RepairOrderLaborCard, RepairOrderPartsCard } from "@/components/repair-order-line-items";

type RepairOrder = NonNullable<Awaited<ReturnType<typeof getWebRepairOrderForCurrentShop>>>;

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
  return <RepairOrderPartsCard repairOrderId={order.id} total={order.partsTotal.toString()} lines={order.parts.map((line) => ({ ...line, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString() }))} vendors={order.shop.vendors} editable={editable} />;
}

function LaborSection({ order, editable }: { order: RepairOrder; editable: boolean }) {
  return <RepairOrderLaborCard repairOrderId={order.id} total={order.laborTotal.toString()} lines={order.labor.map((line) => ({ ...line, hours: line.hours.toString(), hourlyRate: line.hourlyRate.toString() }))} services={order.shop.cannedServices.map((service) => ({ ...service, defaultHours: service.defaultHours.toString(), defaultLaborRate: service.defaultLaborRate.toString() }))} defaultRate={order.shop.defaultLaborRate.toString()} editable={editable} />;
}

function TotalsSection({ order }: { order: RepairOrder }) {
  return <section className="ml-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-slate-950">Repair Order Summary</h2><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-slate-600">Parts total</dt><dd className="font-medium text-slate-950">{formatMoney(order.partsTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Labor total</dt><dd className="font-medium text-slate-950">{formatMoney(order.laborTotal)}</dd></div><div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd className="font-medium text-slate-950">{formatMoney(Number(order.partsTotal) + Number(order.laborTotal))}</dd></div>{order.shopSuppliesEnabledSnapshot && <div><div className="flex justify-between"><dt className="text-slate-600">Shop supplies</dt><dd className="font-medium text-slate-950">{formatMoney(order.shopSuppliesAmount)}</dd></div><p className="mt-1 text-xs text-slate-500">{order.shopSuppliesRateSnapshot.mul(100).toString()}% of labor, maximum {formatMoney(order.shopSuppliesCapSnapshot)}</p></div>}<div className="flex justify-between"><dt className="text-slate-600">Estimated tax</dt><dd className="font-medium text-slate-950">{formatMoney(order.taxTotal)}</dd></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold"><dt>Estimated total</dt><dd>{formatMoney(order.estimatedTotal)}</dd></div></dl></section>;
}
