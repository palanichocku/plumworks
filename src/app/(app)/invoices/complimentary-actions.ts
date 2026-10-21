"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ComplimentaryEditActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

async function requireEditableInvoice(invoiceId: string) {
  if (!UUID.test(invoiceId)) throw new Error("Invalid invoice.");
  const { membership } = await requirePermission("edit_draft_repair_order");
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      shopId: membership.shopId,
      status: "open",
      legacySourceTable: null,
    },
    select: { id: true },
  });
  if (!invoice) throw new Error("Closed or historical invoices cannot be edited.");
  return membership.shopId;
}

function descriptionFrom(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  if (!description || description.length > 500) throw new Error("Enter a complimentary service description.");
  return description;
}

function refresh(invoiceId: string) {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/invoices/${invoiceId}/edit`);
}

export async function addInvoiceComplimentary(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const description = descriptionFrom(formData);
  const shopId = await requireEditableInvoice(invoiceId);
  await prisma.invoiceLabor.create({
    data: {
      shopId,
      invoiceId,
      description,
      hours: 0,
      hourlyRate: 0,
      complimentary: true,
      shopSuppliesEligible: false,
      legacyLineKey: `web:invoice:${invoiceId}:complimentary:${crypto.randomUUID()}`,
    },
  });
  refresh(invoiceId);
}

export async function updateInvoiceComplimentary(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const laborId = String(formData.get("laborId") ?? "");
  const description = descriptionFrom(formData);
  if (!UUID.test(laborId)) throw new Error("Invalid complimentary service.");
  const shopId = await requireEditableInvoice(invoiceId);
  const result = await prisma.invoiceLabor.updateMany({
    where: { id: laborId, invoiceId, shopId, complimentary: true },
    data: { description, hours: 0, hourlyRate: 0, shopSuppliesEligible: false },
  });
  if (result.count !== 1) throw new Error("Complimentary service not found.");
  refresh(invoiceId);
}

export async function deleteInvoiceComplimentary(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const laborId = String(formData.get("laborId") ?? "");
  if (!UUID.test(laborId)) throw new Error("Invalid complimentary service.");
  const shopId = await requireEditableInvoice(invoiceId);
  const result = await prisma.invoiceLabor.deleteMany({
    where: { id: laborId, invoiceId, shopId, complimentary: true },
  });
  if (result.count !== 1) throw new Error("Complimentary service not found.");
  refresh(invoiceId);
}

async function stateResult(action: (formData: FormData) => Promise<void>, formData: FormData): Promise<ComplimentaryEditActionState> {
  try {
    await action(formData);
    return { status: "success" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The complimentary service could not be saved.",
    };
  }
}

export async function addInvoiceComplimentaryWithState(_state: ComplimentaryEditActionState, formData: FormData) {
  return stateResult(addInvoiceComplimentary, formData);
}

export async function updateInvoiceComplimentaryWithState(_state: ComplimentaryEditActionState, formData: FormData) {
  return stateResult(updateInvoiceComplimentary, formData);
}
