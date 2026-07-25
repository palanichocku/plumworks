import { notFound } from "next/navigation";
import { InvoiceEditWorkspace } from "@/components/invoice-edit-workspace";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { isEditableOpenInvoice } from "@/lib/invoice-lifecycle";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoiceForCurrentShop(id);
  if (!invoice || !isEditableOpenInvoice(invoice)) notFound();

  return <InvoiceEditWorkspace invoice={{
    id: invoice.id,
    repairOrderNumber: invoice.repairOrderNumber,
    customerComplaint: invoice.customerComplaint,
    recommendation: invoice.recommendation,
    partsTotal: invoice.partsTotal.toString(),
    laborTotal: invoice.laborTotal.toString(),
    parts: invoice.parts.map((part) => ({ id: part.id, description: part.description, quantity: part.quantity.toString(), unitPrice: part.unitPrice.toString() })),
    labor: invoice.labor.map((labor) => ({ id: labor.id, description: labor.description, hours: labor.hours.toString(), hourlyRate: labor.hourlyRate.toString() })),
  }} />;
}
