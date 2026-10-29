import { notFound, redirect } from "next/navigation";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { formatMoney } from "@/lib/formatters";
import { getInvoiceDeliverySignatureEvidence } from "@/lib/authorization/invoice-signature-evidence";
import { getInvoiceDeliverySignatureDefaults } from "@/lib/authorization/invoice-signature-defaults";
import { InvoiceDeliverySignatureCapture } from "@/components/invoice-delivery-signature-capture";

export const dynamic = "force-dynamic";

export default async function InvoiceDeliverySignaturesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [invoice, signatureEvidence, signatureDefaults] = await Promise.all([
    getInvoiceForCurrentShop(id),
    getInvoiceDeliverySignatureEvidence(id),
    getInvoiceDeliverySignatureDefaults(),
  ]);

  if (!invoice) notFound();

  if (
    invoice.legacySourceTable !== null ||
    invoice.status === "void" ||
    !signatureEvidence
  ) {
    redirect(`/invoices/${id}`);
  }

  if (signatureEvidence.currentComplete) {
    redirect(`/invoices/${id}`);
  }

  const vehicleLabel = invoice.vehicle
    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
        .filter(Boolean)
        .join(" ") || "Vehicle details unavailable"
    : "Vehicle not linked";

  return (
    <InvoiceDeliverySignatureCapture
      invoiceId={invoice.id}
      invoiceNumber={`RO #${invoice.repairOrderNumber ?? "—"}`}
      vehicleLabel={vehicleLabel}
      totalLabel={formatMoney(invoice.total)}
      defaultCustomerName={invoice.customer.displayName}
      defaultShopRepresentativeName={signatureDefaults.shopRepresentativeName}
      defaultShopRepresentativeSignature={signatureDefaults.shopRepresentativeSignatureData}
    />
  );
}
