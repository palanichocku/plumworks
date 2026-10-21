import { notFound } from "next/navigation";
import { InvoiceEditWorkspaceV3 } from "@/components/invoice-edit-workspace-v3";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { invoiceBalance, isEditableOpenInvoice } from "@/lib/invoice-lifecycle";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoiceForCurrentShop(id);
  if (!invoice || !isEditableOpenInvoice(invoice)) notFound();
  const balance = invoice.accountsReceivable[0]?.balance ?? invoiceBalance(invoice.total, invoice.paidTotal);
  const subtotalBeforeTax = invoice.partsTotal.plus(invoice.laborTotal).plus(invoice.shopSuppliesAmount).toDecimalPlaces(2);

  return <div className="invoice-edit-fullwidth">
    <style>{`
      @media (min-width: 64rem) {
        .invoice-edit-fullwidth > div > div.grid {
          grid-template-columns: minmax(0, 1fr) 20rem !important;
          align-items: start;
        }
        .invoice-edit-fullwidth > div > div.grid > main {
          display: contents;
        }
        .invoice-edit-fullwidth > div > div.grid > main > form {
          grid-column: 1;
          grid-row: 1;
        }
        .invoice-edit-fullwidth > div > div.grid > main > section {
          grid-column: 1 / -1;
          grid-row: 2;
          min-width: 0;
        }
        .invoice-edit-fullwidth > div > div.grid > aside {
          grid-column: 2;
          grid-row: 1;
          position: static !important;
          align-self: stretch;
        }
      }
    `}</style>
    <InvoiceEditWorkspaceV3 invoice={{
      id: invoice.id,
      repairOrderNumber: invoice.repairOrderNumber,
      customerComplaint: invoice.customerComplaint,
      recommendation: invoice.recommendation,
      discountAmount: invoice.discountAmount.toFixed(2),
      totals: {
        parts: invoice.partsTotal.toFixed(2), labor: invoice.laborTotal.toFixed(2), shopSupplies: invoice.shopSuppliesAmount.toFixed(2),
        subtotalBeforeTax: subtotalBeforeTax.toFixed(2), discount: invoice.discountAmount.toFixed(2), tax: invoice.taxTotal.toFixed(2), total: invoice.total.toFixed(2),
        paid: invoice.paidTotal.toFixed(2), balance: balance.toFixed(2),
      },
      vendors: invoice.shop.vendors,
      services: invoice.shop.cannedServices.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        defaultHours: service.defaultHours.toString(),
        defaultLaborRate: service.defaultLaborRate.toString(),
        shopSuppliesEligible: service.shopSuppliesEligible,
      })),
      defaultLaborRate: invoice.shop.defaultLaborRate.toString(),
      parts: invoice.parts.map((part) => ({ id: part.id, description: part.description, quantity: part.quantity.toString(), unitPrice: part.unitPrice.toString(), vendorNameSnapshot: part.vendorNameSnapshot })),
      labor: invoice.labor.filter((labor) => !labor.complimentary).map((labor) => ({ id: labor.id, description: labor.description, hours: labor.hours.toString(), hourlyRate: labor.hourlyRate.toString(), shopSuppliesEligible: labor.shopSuppliesEligible })),
      complimentary: invoice.labor.filter((labor) => labor.complimentary).map((labor) => ({ id: labor.id, description: labor.description })),
    }} />
  </div>;
}
