import Link from "next/link";
import { notFound } from "next/navigation";
import { getWebRepairOrderForCurrentShop } from "@/lib/data/repair-orders";
import { formatMoney } from "@/lib/formatters";
import { finalizeRepairOrder } from "../../finalize-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

export const dynamic = "force-dynamic";

export default async function FinalizeRepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getWebRepairOrderForCurrentShop(id);
  if (!order || !["draft", "open"].includes(order.status)) notFound();

  return <div className="mx-auto max-w-2xl">
    <Link href={`/repair-orders/${order.id}`} className="text-sm font-semibold text-sky-700">← Back to repair order</Link>
    <section className="mt-6 rounded-2xl border border-amber-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-amber-700">Final confirmation</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">Create invoice for RO #{order.repairOrderNumber}</h1>
      <p className="mt-4 leading-7 text-slate-600">Finalization copies the current parts and labor into an invoice and makes this repair order read-only. Payment is not collected in this step.</p>
      <dl className="mt-6 grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-slate-50 p-5 text-sm"><dt>Parts</dt><dd>{formatMoney(order.partsTotal)}</dd><dt>Labor</dt><dd>{formatMoney(order.laborTotal)}</dd><dt>Estimated tax</dt><dd>{formatMoney(order.taxTotal)}</dd><dt className="border-t border-slate-300 pt-3 font-bold">Invoice total</dt><dd className="border-t border-slate-300 pt-3 font-bold">{formatMoney(order.estimatedTotal)}</dd></dl>
      <form action={finalizeRepairOrder} className="mt-7 flex flex-wrap gap-3"><input type="hidden" name="repairOrderId" value={order.id} /><FormSubmitButton pendingLabel="Finalizing…" confirmTitle="Finalize this repair order?" confirmDescription="An invoice will be created and the repair order will become read-only." confirmLabel="Finalize and create invoice" className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Finalize and create invoice</FormSubmitButton><Link href={`/repair-orders/${order.id}`} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</Link></form>
    </section>
  </div>;
}
