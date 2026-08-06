import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { RepairOrderDocumentHTML } from "@/components/repair-order-document-html";
import { getRepairOrderDocumentForCurrentShop } from "@/lib/repair-order-document";

export const dynamic = "force-dynamic";

export default async function PrintableRepairOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = await getRepairOrderDocumentForCurrentShop(id);
  if (!model) notFound();

  return <div className="invoice-print-route repair-order-print-route">
    <div className="print-hidden mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-4 rounded-lg bg-white px-4 py-3 text-slate-900">
      <Link href={`/repair-orders/${model.id}`} className="text-sm font-semibold text-brand-primary">← Back to repair order</Link>
      <PrintButton />
    </div>
    <RepairOrderDocumentHTML model={model} />
  </div>;
}
