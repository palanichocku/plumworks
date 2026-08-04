import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentMembership } from "@/lib/data/membership";
import { formatDate, formatLaborDescription, formatMoney } from "@/lib/formatters";
import { snapshotNumber, snapshotString } from "@/lib/invoice-snapshots";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invoiceDocumentSelect = {
  id: true, repairOrderNumber: true, legacyRoNo: true, legacySourceTable: true,
  invoiceDate: true, odometer: true, status: true, closedAt: true, deliveredAt: true, createdAt: true,
  customerComplaint: true, recommendation: true, partsTotal: true, laborTotal: true,
  subtotal: true, shopSuppliesAmount: true, taxTotal: true, total: true, paidTotal: true,
  shopSnapshot: true, customerSnapshot: true, vehicleSnapshot: true,
  shop: { select: {
    name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true,
    invoiceFooterMessage: true, warrantyText: true, invoicePartsWarrantyText: true,
    invoiceAuthorizationText: true, invoiceCertificationText: true,
    repairFacilityRegistrationNumber: true, defaultAuthorizedRepresentative: true,
    defaultInvoiceTechnicianName: true, defaultInvoiceTechnicianLicenseNumber: true,
  } },
  customer: { select: {
    displayName: true, addressLine1: true, addressLine2: true, city: true, state: true,
    postalCode: true, phone: true, email: true,
  } },
  vehicle: { select: {
    year: true, make: true, model: true, engine: true, vin: true, licensePlate: true, odometer: true,
  } },
  repairOrder: { select: {
    openedAt: true, odometer: true,
    assignedEmployee: { select: { displayName: true } },
  } },
  accountsReceivable: { take: 1, select: { balance: true } },
  payments: { orderBy: [{ paidAt: "asc" as const }, { createdAt: "asc" as const }], select: { amount: true, method: true } },
  parts: { orderBy: { createdAt: "asc" as const }, select: {
    description: true, partNumber: true, quantity: true, unitPrice: true,
  } },
  labor: { orderBy: { createdAt: "asc" as const }, select: {
    description: true, hours: true, hourlyRate: true,
  } },
  legacyCharges: { orderBy: { sourceBucket: "asc" as const }, select: { sourceLabel: true, sourceBucket: true, amount: true } },
} satisfies Prisma.InvoiceSelect;

type InvoiceDocumentRecord = Prisma.InvoiceGetPayload<{ select: typeof invoiceDocumentSelect }>;

export type InvoiceDocumentModel = ReturnType<typeof mapInvoiceDocument>;

function snapshotSetting(invoice: InvoiceDocumentRecord, field: string, fallback: string | null) {
  return snapshotString(invoice.shopSnapshot, field, fallback);
}

function mapInvoiceDocument(invoice: InvoiceDocumentRecord) {
  const shop = invoice.shop;
  const customer = invoice.customer;
  const vehicle = invoice.vehicle;
  const invoiceNumber = String(invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not assigned");
  const balance = invoice.accountsReceivable[0]?.balance ?? invoice.total.minus(invoice.paidTotal).toDecimalPlaces(2);
  const displaySubtotalBeforeTax = invoice.partsTotal.plus(invoice.laborTotal).plus(invoice.shopSuppliesAmount).toDecimalPlaces(2);
  const paymentTotals = new Map<string, Prisma.Decimal>();
  for (const payment of invoice.payments) {
    const method = payment.method?.trim() || "Other";
    paymentTotals.set(method, (paymentTotals.get(method) ?? new Prisma.Decimal(0)).plus(payment.amount));
  }
  const assignedTechnician = invoice.repairOrder?.assignedEmployee?.displayName ?? null;
  const configuredTechnician = snapshotSetting(invoice, "defaultInvoiceTechnicianName", shop.defaultInvoiceTechnicianName);
  const technicianName = assignedTechnician ?? configuredTechnician;

  return {
    id: invoice.id,
    invoiceNumber,
    filename: `invoice-${invoiceNumber.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document"}.pdf`,
    status: invoice.status,
    invoiceDate: formatDate(invoice.invoiceDate),
    createdDate: formatDate(invoice.createdAt),
    closedDate: invoice.closedAt ? formatDate(invoice.closedAt) : null,
    deliveredDate: invoice.deliveredAt ? formatDate(invoice.deliveredAt) : null,
    repairOrderReference: invoice.repairOrderNumber === null ? null : String(invoice.repairOrderNumber),
    legacyRepairOrderReference: invoice.legacyRoNo,
    shop: {
      name: snapshotString(invoice.shopSnapshot, "name", shop.name) ?? shop.name,
      addressLine1: snapshotString(invoice.shopSnapshot, "addressLine1", shop.addressLine1),
      city: snapshotString(invoice.shopSnapshot, "city", shop.city),
      state: snapshotString(invoice.shopSnapshot, "state", shop.state),
      postalCode: snapshotString(invoice.shopSnapshot, "postalCode", shop.postalCode),
      phone: snapshotString(invoice.shopSnapshot, "phone", shop.phone),
      repairFacilityRegistrationNumber: snapshotSetting(invoice, "repairFacilityRegistrationNumber", shop.repairFacilityRegistrationNumber),
      authorizedRepresentative: snapshotSetting(invoice, "defaultAuthorizedRepresentative", shop.defaultAuthorizedRepresentative),
      technicianName,
      technicianLicenseNumber: snapshotSetting(invoice, "defaultInvoiceTechnicianLicenseNumber", shop.defaultInvoiceTechnicianLicenseNumber),
      footerMessage: snapshotSetting(invoice, "invoiceFooterMessage", shop.invoiceFooterMessage),
      laborWarrantyText: snapshotSetting(invoice, "warrantyText", shop.warrantyText),
      partsWarrantyText: snapshotSetting(invoice, "invoicePartsWarrantyText", shop.invoicePartsWarrantyText),
      authorizationText: snapshotSetting(invoice, "invoiceAuthorizationText", shop.invoiceAuthorizationText),
      certificationText: snapshotSetting(invoice, "invoiceCertificationText", shop.invoiceCertificationText),
    },
    customer: {
      name: snapshotString(invoice.customerSnapshot, "displayName", customer.displayName) ?? customer.displayName,
      addressLine1: snapshotString(invoice.customerSnapshot, "addressLine1", customer.addressLine1),
      addressLine2: snapshotString(invoice.customerSnapshot, "addressLine2", customer.addressLine2),
      city: snapshotString(invoice.customerSnapshot, "city", customer.city),
      state: snapshotString(invoice.customerSnapshot, "state", customer.state),
      postalCode: snapshotString(invoice.customerSnapshot, "postalCode", customer.postalCode),
      phone: snapshotString(invoice.customerSnapshot, "phone", customer.phone),
      email: snapshotString(invoice.customerSnapshot, "email", customer.email),
    },
    vehicle: vehicle || invoice.vehicleSnapshot ? {
      year: snapshotNumber(invoice.vehicleSnapshot, "year", vehicle?.year ?? null),
      make: snapshotString(invoice.vehicleSnapshot, "make", vehicle?.make ?? null),
      model: snapshotString(invoice.vehicleSnapshot, "model", vehicle?.model ?? null),
      engine: snapshotString(invoice.vehicleSnapshot, "engine", vehicle?.engine ?? null),
      vin: snapshotString(invoice.vehicleSnapshot, "vin", vehicle?.vin ?? null),
      licensePlate: snapshotString(invoice.vehicleSnapshot, "licensePlate", vehicle?.licensePlate ?? null),
      odometer: invoice.odometer ?? invoice.repairOrder?.odometer ?? null,
    } : null,
    complaint: invoice.customerComplaint,
    recommendation: invoice.recommendation,
    parts: invoice.parts.map((part) => ({
      description: part.description, partNumber: part.partNumber, quantity: part.quantity.toString(),
      unitPrice: formatMoney(part.unitPrice), extendedAmount: formatMoney(part.quantity.mul(part.unitPrice).toDecimalPlaces(2)),
    })),
    labor: invoice.labor.map((labor) => ({
      description: formatLaborDescription(labor.description), hours: labor.hours.toString(),
      hourlyRate: formatMoney(labor.hourlyRate), amount: formatMoney(labor.hours.mul(labor.hourlyRate).toDecimalPlaces(2)),
      technician: technicianName,
    })),
    legacyCharges: invoice.legacyCharges.map((charge) => ({ label: charge.sourceLabel?.trim() || charge.sourceBucket, amount: formatMoney(charge.amount) })),
    totals: {
      parts: formatMoney(invoice.partsTotal), labor: formatMoney(invoice.laborTotal), subtotal: formatMoney(invoice.subtotal), displaySubtotalBeforeTax: formatMoney(displaySubtotalBeforeTax),
      shopSupplies: formatMoney(invoice.shopSuppliesAmount), tax: formatMoney(invoice.taxTotal), total: formatMoney(invoice.total),
      amountPaid: formatMoney(invoice.paidTotal), balanceDue: formatMoney(balance),
    },
    paymentMethods: [...paymentTotals.entries()].map(([method, amount]) => ({ method, amount: formatMoney(amount) })),
  };
}

export async function getInvoiceDocumentForShop(invoiceId: string, shopId: string) {
  if (!UUID.test(invoiceId)) return null;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, shopId }, select: invoiceDocumentSelect });
  return invoice ? mapInvoiceDocument(invoice) : null;
}

export async function getInvoiceDocumentForCurrentShop(invoiceId: string) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return null;
  return getInvoiceDocumentForShop(invoiceId, membership.shopId);
}
