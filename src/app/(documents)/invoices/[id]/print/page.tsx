import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocumentHTML } from "@/components/invoice-document-html";
import { PrintButton } from "@/components/print-button";
import { getInvoiceDocumentForCurrentShop } from "@/lib/invoice-document";

export const dynamic = "force-dynamic";

export default async function PrintableInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = await getInvoiceDocumentForCurrentShop(id);
  if (!model) notFound();

  return <div className="invoice-print-route">
    <div className="print-hidden mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-4 rounded-lg bg-white px-4 py-3 text-slate-900">
      <Link href={`/invoices/${model.id}`} className="text-sm font-semibold text-brand-primary">← Back to invoice</Link>
      <PrintButton />
    </div>
    <InvoiceDocumentHTML model={model} />
  </div>;
}
