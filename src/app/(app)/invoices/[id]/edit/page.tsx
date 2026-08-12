import { notFound } from "next/navigation";
import { InvoiceEditWorkspace } from "@/components/invoice-edit-workspace";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { invoiceBalance, isEditableOpenInvoice } from "@/lib/invoice-lifecycle";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoiceForCurrentShop(id);
  if (!invoice || !isEditableOpenInvoice(invoice)) notFound();
  const balance = invoice.accountsReceivable[0]?.balance ?? invoiceBalance(invoice.total, invoice.paidTotal);
  const subtotalBeforeTax = invoice.partsTotal.plus(invoice.laborTotal).plus(invoice.shopSuppliesAmount).toDecimalPlaces(2);

  return <InvoiceEditWorkspace invoice={{
    id: invoice.id,
    repairOrderNumber: invoice.repairOrderNumber,
    customerComplaint: invoice.customerComplaint,
    recommendation: invoice.recommendation,
    partsTotal: invoice.partsTotal.toString(),
    laborTotal: invoice.laborTotal.toString(),
    totals: {
      parts: invoice.partsTotal.toFixed(2), labor: invoice.laborTotal.toFixed(2), shopSupplies: invoice.shopSuppliesAmount.toFixed(2),
      subtotalBeforeTax: subtotalBeforeTax.toFixed(2), tax: invoice.taxTotal.toFixed(2), total: invoice.total.toFixed(2),
      paid: invoice.paidTotal.toFixed(2), balance: balance.toFixed(2),
    },
    parts: invoice.parts.map((part) => ({ id: part.id, description: part.description, quantity: part.quantity.toString(), unitPrice: part.unitPrice.toString() })),
    labor: invoice.labor.filter((labor) => !labor.complimentary).map((labor) => ({ id: labor.id, description: labor.description, hours: labor.hours.toString(), hourlyRate: labor.hourlyRate.toString() })),
  }} />;
}
