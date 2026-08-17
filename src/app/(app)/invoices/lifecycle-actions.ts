"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auditEntry } from "@/lib/audit";
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
  tax: string;
  total: string;
  paid: string;
  balance: string;
};

export async function previewInvoiceEditTotals(invoiceId: string, lines: {
  parts: Array<{ quantity: string; unitPrice: string }>;
  labor: Array<{ hours: string; hourlyRate: string }>;
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
    },
  });
  if (!invoice) return null;
  try {
    const parts = lines.parts.map((line) => ({ quantity: money(line.quantity), unitPrice: money(line.unitPrice) }));
    const labor = lines.labor.map((line) => ({ hours: money(line.hours), hourlyRate: money(line.hourlyRate) }));
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
    });
    const payments = await prisma.payment.aggregate({ where: { invoiceId, shopId: membership.shopId }, _sum: { amount: true } });
    const paid = payments._sum.amount ?? new Prisma.Decimal(0);
    return {
      parts: totals.partsTotal.toFixed(2),
      labor: totals.laborTotal.toFixed(2),
      shopSupplies: totals.shopSuppliesAmount.toFixed(2),
      subtotalBeforeTax: totals.partsTotal.plus(totals.laborTotal).plus(totals.shopSuppliesAmount).toDecimalPlaces(2).toFixed(2),
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
    id: true, total: true, paidTotal: true, shopSuppliesEnabledSnapshot: true, shopSuppliesRateSnapshot: true, shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true, shopSnapshot: true,
    parts: { select: { quantity: true, unitPrice: true } }, labor: { where: { complimentary: false }, select: { hours: true, hourlyRate: true } }, accountsReceivable: { take: 1, select: { id: true } },
  } });
  const shop = (invoice.shopSnapshot ?? {}) as { defaultTaxRate?: string | number; partsTaxable?: boolean; laborTaxable?: boolean };
  const totals = calculateEditableInvoiceTotals({ parts: invoice.parts, labor: invoice.labor, shopSuppliesEnabled: invoice.shopSuppliesEnabledSnapshot ?? false, shopSuppliesRate: invoice.shopSuppliesRateSnapshot ?? 0, shopSuppliesCap: invoice.shopSuppliesCapSnapshot ?? 0, taxRate: shop.defaultTaxRate ?? 0, partsTaxable: shop.partsTaxable ?? true, laborTaxable: shop.laborTaxable ?? false, shopSuppliesTaxable: invoice.shopSuppliesTaxableSnapshot ?? true });
  const paid = await transaction.payment.aggregate({ where: { invoiceId, shopId }, _sum: { amount: true } });
  const paidTotal = paid._sum.amount ?? new Prisma.Decimal(0);
  const balance = invoiceBalance(totals.total, paidTotal);
  if (balance.lessThan(0)) throw new Error("Invoice changes cannot reduce the total below payments already received.");
  await transaction.invoice.update({ where: { id: invoiceId }, data: { ...totals, paidTotal } });
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

export async function updateInvoiceDetails(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const customerComplaint = String(formData.get("customerComplaint") ?? "");
  const recommendation = String(formData.get("recommendation") ?? "");
  if (customerComplaint.length > 10000 || recommendation.length > 10000) throw new Error("Invoice notes are too long.");
  await mutateOpenInvoice(invoiceId, async (transaction) => { await transaction.invoice.update({ where: { id: invoiceId }, data: { customerComplaint: customerComplaint || null, recommendation: recommendation || null } }); });
}

export async function addInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const quantity = money(formData.get("quantity")); const unitPrice = money(formData.get("unitPrice"));
  if (!description || description.length > 500 || !quantity.greaterThan(0)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { await transaction.invoicePart.create({ data: { shopId, invoiceId, description, quantity, unitPrice, legacyLineKey: `web:invoice:${invoiceId}:part:${crypto.randomUUID()}` } }); });
}

export async function updateInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const partId = String(formData.get("partId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const quantity = money(formData.get("quantity")); const unitPrice = money(formData.get("unitPrice"));
  if (!UUID.test(partId) || !description || !quantity.greaterThan(0)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoicePart.updateMany({ where: { id: partId, invoiceId, shopId }, data: { description, quantity, unitPrice } }); if (result.count !== 1) throw new Error("Part not found."); });
}

export async function deleteInvoicePart(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const partId = String(formData.get("partId") ?? "");
  if (!UUID.test(partId)) throw new Error("Invalid part.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoicePart.deleteMany({ where: { id: partId, invoiceId, shopId } }); if (result.count !== 1) throw new Error("Part not found."); });
}

export async function addInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const hours = money(formData.get("hours")); const hourlyRate = money(formData.get("hourlyRate"));
  if (!description || description.length > 500 || !hours.greaterThan(0)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { await transaction.invoiceLabor.create({ data: { shopId, invoiceId, description, hours, hourlyRate, complimentary: false, legacyLineKey: `web:invoice:${invoiceId}:labor:${crypto.randomUUID()}` } }); });
}

export async function updateInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const laborId = String(formData.get("laborId") ?? ""); const description = String(formData.get("description") ?? "").trim(); const hours = money(formData.get("hours")); const hourlyRate = money(formData.get("hourlyRate"));
  if (!UUID.test(laborId) || !description || !hours.greaterThan(0)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoiceLabor.updateMany({ where: { id: laborId, invoiceId, shopId, complimentary: false }, data: { description, hours, hourlyRate } }); if (result.count !== 1) throw new Error("Labor not found."); });
}

export async function deleteInvoiceLabor(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? ""); const laborId = String(formData.get("laborId") ?? "");
  if (!UUID.test(laborId)) throw new Error("Invalid labor.");
  await mutateOpenInvoice(invoiceId, async (transaction, shopId) => { const result = await transaction.invoiceLabor.deleteMany({ where: { id: laborId, invoiceId, shopId, complimentary: false } }); if (result.count !== 1) throw new Error("Labor not found."); });
}

export type InvoiceEditActionState = { status: "idle" | "success" | "error"; message?: string };

async function invoiceEditResult(action: (formData: FormData) => Promise<void>, formData: FormData, message: string): Promise<InvoiceEditActionState> {
  try {
    await action(formData);
    return { status: "success" };
  } catch {
    return { status: "error", message };
  }
}

export async function updateInvoiceDetailsWithState(_state: InvoiceEditActionState, formData: FormData) {
  return invoiceEditResult(updateInvoiceDetails, formData, "Invoice details could not be saved. Check the values and try again.");
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

export async function closeInvoice(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!UUID.test(invoiceId) || formData.get("vehicleDelivered") !== "yes") throw new Error("Vehicle delivery confirmation is required.");
  const { user, membership } = await requirePermission("finalize_repair_order");
  if (!(["OWNER", "ADMIN"] as string[]).includes(membership.role)) throw new Error("Only an owner or administrator can close invoices.");
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
    await refreshInvoice(transaction, membership.shopId, invoiceId);
    const invoice = await transaction.invoice.findFirst({ where: { id: invoiceId, shopId: membership.shopId, status: "open", legacySourceTable: null }, select: { id: true, total: true, repairOrderNumber: true } });
    if (!invoice) throw new Error("Invoice is not open.");
    const payments = await transaction.payment.aggregate({ where: { invoiceId, shopId: membership.shopId }, _sum: { amount: true } });
    const balance = invoiceBalance(invoice.total, payments._sum.amount ?? 0);
    if (!balance.isZero()) throw new Error(`Invoice balance must be $0.00 before closing. Remaining balance: $${balance.toFixed(2)}.`);
    const now = new Date();
    await transaction.invoice.update({ where: { id: invoiceId }, data: { status: "closed", paidTotal: invoice.total, closedAt: now, deliveredAt: now, closedByUserId: user?.id ?? null } });
    await transaction.auditLog.create({ data: auditEntry(membership.shopId, user?.id, "invoice_closed", "invoice", invoiceId, { delivered: true }, { actorEmail: user?.email, actorRole: membership.role, entityLabel: `Invoice RO #${invoice.repairOrderNumber}`, entityHref: `/invoices/${invoiceId}`, contextSummary: "Invoice closed after delivery confirmation" }) });
  }, { isolationLevel: "Serializable" });
  revalidatePath(`/invoices/${invoiceId}`); redirect(`/invoices/${invoiceId}`);
}
