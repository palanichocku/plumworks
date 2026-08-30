"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { calculateEditableInvoiceTotals, invoiceBalance } from "@/lib/invoice-lifecycle";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Invalid financial value.");
  return new Prisma.Decimal(text).toDecimalPlaces(2);
};

export type InvoiceEditPreview = {
  parts: string;
  labor: string;
  shopSupplies: string;
  subtotalBeforeTax: string;
  discount: string;
  tax: string;
  total: string;
  paid: string;
  balance: string;
};

export async function previewInvoiceEditTotals(invoiceId: string, lines: {
  parts: Array<{ quantity: string; unitPrice: string }>;
  labor: Array<{ hours: string; hourlyRate: string; shopSuppliesEligible: boolean }>;
  discountAmount: string;
}): Promise<InvoiceEditPreview | null> {
  if (!UUID.test(invoiceId) || lines.parts.length > 100 || lines.labor.length > 100) return null;
  const { membership } = await requirePermission("edit_draft_repair_order");
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, shopId: membership.shopId, status: "open", legacySourceTable: null },
    select: {
      shopSuppliesEnabledSnapshot: true,
      shopSuppliesRateSnapshot: true,
      shopSuppliesCapSnapshot: true,
      shopSuppliesTaxableSnapshot: true,
      shopSnapshot: true,
      discountAmount: true,
    },
  });
  if (!invoice) return null;
  try {
    const parts = lines.parts.map((line) => ({ quantity: money(line.quantity), unitPrice: money(line.unitPrice) }));
    const labor = lines.labor.map((line) => ({ hours: money(line.hours), hourlyRate: money(line.hourlyRate), shopSuppliesEligible: line.shopSuppliesEligible }));
    if (parts.some((line) => !line.quantity.greaterThan(0)) || labor.some((line) => !line.hours.greaterThan(0))) return null;
    const shop = (invoice.shopSnapshot ?? {}) as { defaultTaxRate?: string | number; partsTaxable?: boolean; laborTaxable?: boolean };
    const totals = calculateEditableInvoiceTotals({
      parts,
      labor,
      shopSuppliesEnabled: invoice.shopSuppliesEnabledSnapshot ?? false,
      shopSuppliesRate: invoice.shopSuppliesRateSnapshot ?? 0,
      shopSuppliesCap: invoice.shopSuppliesCapSnapshot ?? 0,
      taxRate: shop.defaultTaxRate ?? 0,
      partsTaxable: shop.partsTaxable ?? true,
      laborTaxable: shop.laborTaxable ?? false,
      shopSuppliesTaxable: invoice.shopSuppliesTaxableSnapshot ?? true,
      discountAmount: money(lines.discountAmount),
    });
    const payments = await prisma.payment.aggregate({ where: { invoiceId, shopId: membership.shopId }, _sum: { amount: true } });
    const paid = payments._sum.amount ?? new Prisma.Decimal(0);
    return {
      parts: totals.partsTotal.toFixed(2),
      labor: totals.laborTotal.toFixed(2),
      shopSupplies: totals.shopSuppliesAmount.toFixed(2),
      subtotalBeforeTax: totals.partsTotal.plus(totals.laborTotal).plus(totals.shopSuppliesAmount).toDecimalPlaces(2).toFixed(2),
      discount: totals.discountAmount.toFixed(2),
      tax: totals.taxTotal.toFixed(2),
      total: totals.total.toFixed(2),
      paid: paid.toDecimalPlaces(2).toFixed(2),
      balance: invoiceBalance(totals.total, paid).toFixed(2),
    };
  } catch {
    return null;
  }
}

async function refreshInvoice(transaction: Prisma.TransactionClient, shopId: string, invoiceId: string) {
  const invoice = await transaction.invoice.findFirstOrThrow({ where: { id: invoiceId, shopId, status: "open", legacySourceTable: null }, select: {
    id: true, total: true, paidTotal: true, discountAmount: true, shopSuppliesEnabledSnapshot: true, shopSuppliesRateSnapshot: true, shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true, shopSnapshot: true,
    parts: { select: { quantity: true, unitPrice: true } }, labor: { where: { complimentary: false }, select: { hours: true, hourlyRate: true, shopSuppliesEligible: true } }, accountsReceivable: { take: 1, select: { id: true } },
  } });
  const shop = (invoice.shopSnapshot ?? {}) as { defaultTaxRate?: string | number; partsTaxable?: boolean; laborTaxable?: boolean };
  const totals = calculateEditableInvoiceTotals({ parts: invoice.parts, labor: invoice.labor, shopSuppliesEnabled: invoice.shopSuppliesEnabledSnapshot ?? false, shopSuppliesRate: invoice.shopSuppliesRateSnapshot ?? 0, shopSuppliesCap: invoice.shopSuppliesCapSnapshot ?? 0, taxRate: shop.defaultTaxRate ?? 0, partsTaxable: shop.partsTaxable ?? true, laborTaxable: shop.laborTaxable ?? false, shopSuppliesTaxable: invoice.shopSuppliesTaxableSnapshot ?? true, discountAmount: invoice.discountAmount });
  const paid = await transaction.payment.aggregate({ where: { invoiceId, shopId }, _sum: { amount: true } });
  const paidTotal = paid._sum.amount ?? new Prisma.Decimal(0);
  const balance = invoiceBalance(totals.total, paidTotal);
  if (balance.lessThan(0)) throw new Error("Invoice changes cannot reduce the total below payments already received.");
  await transaction.invoice.update({ where: { id: invoiceId }, data: { partsTotal: totals.partsTotal, laborTotal: totals.laborTotal, subtotal: totals.subtotal, discountAmount: totals.discountAmount, shopSuppliesAmount: totals.shopSuppliesAmount, shopSuppliesEligibleLaborTotal: totals.shopSuppliesEligibleLaborTotal, shopSuppliesCalculatedAmount: totals.shopSuppliesCalculatedAmount, taxTotal: totals.taxTotal, total: totals.total, paidTotal } });
  if (invoice.accountsReceivable[0]) await transaction.accountReceivable.update({ where: { id: invoice.accountsReceivable[0].id }, data: { balance, status: balance.isZero() ? "paid" : "open" } });
}

async function mutateOpenInvoice(invoiceId: string, mutation: (transaction: Prisma.TransactionClient, shopId: string) => Promise<void>) {
  if (!UUID.test(invoiceId)) throw new Error("Invalid invoice.");
  const { membership } = await requirePermission("edit_draft_repair_order");
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
    const open = await transaction.invoice.findFirst({ where: { id: invoiceId, shopId: membership.shopId, status: "open", legacySourceTable: null }, select: { id: true } });
    if (!open) throw new Error("Closed or historical invoices cannot be edited.");
    await mutation(transaction, membership.shopId);
    await refreshInvoice(transaction, membership.shopId, invoiceId);
  }, { isolationLevel: "Serializable" });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/invoices/${invoiceId}/edit`);
}

async function invoicePartVendor(transaction: Prisma.TransactionClient, shopId: string, invoiceId: string, formData: FormData) {
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!vendorId) return null;
  if (vendorId === "current-snapshot") {
    const partId = String(formData.get("partId") ?? "");
    if (!UUID.test(partId)) throw new Error("Invalid Invoice Part.");
    const part = await transaction.invoicePart.findFirst({ where: { id: partId, invoiceId, shopId }, select: { vendorNameSnapshot: true } });
    if (!part) throw new Error("Part not found.");
    return part.vendorNameSnapshot;
  }
  if (!UUID.test(vendorId)) throw new Error("Invalid Vendor selection.");
  const vendor = await transaction.vendor.findFirst({ where: { id: vendorId, shopId }, select: { name: true } });
  if (!vendor) throw new Error("That Vendor is not available for this shop.");
  return vendor.name;
}

export async function updateInvoiceDetails(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const customerComplaint = String(formData.get("customerComplaint") ?? "");
  const recommendation = String(formData.get("recommendation") ?? "");
  if (customerComplaint.length > 10000 || recommendation.length > 10000) throw new Error("Invoice notes are too long.");
  await mutateOpenInvoice(invoiceId, async (transaction) => { await transaction.invoice.update({ where: { id: invoiceId }, data: { customerComplaint: customerComplaint || null, recommendation: recommendation || null } }); });
}

export async function updateInvoiceDiscount(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const discountAmount = money(formData.get("discountAmount"));
  await mutateOpenInvoice(invoiceId, async (transaction) => {
    await transaction.invoice.update({ where: { id: invoiceId }, data: { discountAmount } });
  });
}

export async function addInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const quantity = money(formData.get("quantity")); const unitPrice = money(formData.get("unitPrice"));
  if (!description || description.length > 500 || !quantity.greaterThan(0)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const vendorNameSnapshot = await invoicePartVendor(transaction, shopId, invoiceId, formData); await transaction.invoicePart.create({ data: { shopId, invoiceId, description, quantity, unitPrice, vendorNameSnapshot, legacyLineKey: `web:invoice:${invoiceId}:part:${crypto.randomUUID()}` } }); });
}

export async function updateInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const partId = String(formData.get("partId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const quantity = money(formData.get("quantity")); const unitPrice = money(formData.get("unitPrice"));
  if (!UUID.test(partId) || !description || !quantity.greaterThan(0)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const vendorNameSnapshot = await invoicePartVendor(transaction, shopId, invoiceId, formData); const result = await transaction.invoicePart.updateMany({ where: { id: partId, invoiceId, shopId }, data: { description, quantity, unitPrice, vendorNameSnapshot } }); if (result.count !== 1) throw new Error("Part not found."); });
}

export async function deleteInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const partId = String(formData.get("partId") ?? "");
  if (!UUID.test(partId)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoicePart.deleteMany({ where: { id: partId, invoiceId, shopId } }); if (result.count !== 1) throw new Error("Part not found."); });
}

export async function addInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const hours = money(formData.get("hours")); const hourlyRate = money(formData.get("hourlyRate")); const eligibleValue = formData.get("shopSuppliesEligible"); const shopSuppliesEligible = eligibleValue === null || eligibleValue === "true";
  if (!description || description.length > 500 || !hours.greaterThan(0)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { await transaction.invoiceLabor.create({ data: { shopId, invoiceId, description, hours, hourlyRate, complimentary: false, shopSuppliesEligible, legacyLineKey: `web:invoice:${invoiceId}:labor:${crypto.randomUUID()}` } }); });
}

export async function updateInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const laborId = String(formData.get("laborId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const hours = money(formData.get("hours")); const hourlyRate = money(formData.get("hourlyRate")); const shopSuppliesEligible = formData.get("shopSuppliesEligible") === "true";
  if (!UUID.test(laborId) || !description || !hours.greaterThan(0)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoiceLabor.updateMany({ where: { id: laborId, invoiceId, shopId, complimentary: false }, data: { description, hours, hourlyRate, shopSuppliesEligible } }); if (result.count !== 1) throw new Error("Labor not found."); });
}

export async function deleteInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const laborId = String(formData.get("laborId") ?? "");
  if (!UUID.test(laborId)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoiceLabor.deleteMany({ where: { id: laborId, invoiceId, shopId, complimentary: false } }); if (result.count !== 1) throw new Error("Labor not found."); });
}

export type InvoiceEditActionState = { status: "idle" | "success" | "error"; message?: string; value?: string };

async function invoiceEditResult(action: (formData: FormData) => Promise<void>, formData: FormData, message: string): Promise<InvoiceEditActionState> {
  try {
    await action(formData);
    return { status: "success" };
  } catch (error) {
    const financialMessage = error instanceof Error && (error.message.startsWith("Discount ") || error.message.startsWith("Invoice changes cannot reduce")) ? error.message : null;
    return { status: "error", message: financialMessage ?? message };
  }
}

export async function updateInvoiceDetailsWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(updateInvoiceDetails, formData, "Invoice details could not be saved. Check the values and try again.");
}

export async function updateInvoiceDiscountWithState(_state: InvoiceEditActionState, formData: FormData) {
  try {
    await updateInvoiceDiscount(formData);
    return { status: "success", value: money(formData.get("discountAmount")).toFixed(2) } satisfies InvoiceEditActionState;
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The Discount could not be saved." } satisfies InvoiceEditActionState;
  }
}

export async function addInvoicePartWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(addInvoicePart, formData, "The Invoice part could not be added. Check the values and try again.");
}

export async function updateInvoicePartWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(updateInvoicePart, formData, "The Invoice part could not be saved. Check the values and try again.");
}

export async function addInvoiceLaborWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(addInvoiceLabor, formData, "The Invoice labor could not be added. Check the values and try again.");
}

export async function updateInvoiceLaborWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(updateInvoiceLabor, formData, "The Invoice labor could not be saved. Check the values and try again.");
}
