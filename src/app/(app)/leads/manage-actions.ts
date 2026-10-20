"use server";

import { revalidatePath } from "next/cache";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { notifyScheduledMarketingLead } from "@/lib/marketing-lead-notifications";
import { customerPhoneForStorage } from "@/lib/customer-phone";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

const statuses = new Set(Object.values(MarketingLeadStatus));

type LeadCustomerLink = { customer_id: string | null };

function normalizedCustomerName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function updateLeadStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as MarketingLeadStatus;
  const metadata = { event: "marketing_lead_status_update", leadId: /^[0-9a-f-]{36}$/i.test(id) ? id : undefined, requestedStatus: statuses.has(status) ? status : undefined };
  let stage = "authorization";
  console.info({ ...metadata, result: "received" });
  try {
    const { membership } = await requirePermission("manage_marketing_leads");
    console.info({ ...metadata, result: "authorized" });
    stage = "validation";
    const rawDate = String(formData.get("scheduledDate") ?? "").trim();
    const scheduledTime = String(formData.get("scheduledTime") ?? "").trim().slice(0, 5) || null;
    const internalNote = String(formData.get("internalNote") ?? "").trim().slice(0, 3000) || null;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !statuses.has(status)) throw new Error("Invalid lead update.");
    if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new Error("Invalid scheduled date.");
    if (scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw new Error("Invalid scheduled time.");
    if (status === "SCHEDULED" && (!rawDate || !scheduledTime)) throw new Error("Scheduled date and time are required.");
    if (status === "CLOSED" && !internalNote) throw new Error("A Lost reason is required in Internal note.");
    const scheduledDate = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : null;

    console.info({ ...metadata, result: "validated" });
    stage = "persistence";
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM marketing_leads WHERE id = ${id}::uuid AND shop_id = ${membership.shopId}::uuid FOR UPDATE`;
      const existingLead = await transaction.marketingLead.findFirstOrThrow({ where: { id, shopId: membership.shopId } });

      // Converted is system-controlled once a Repair Order exists. The hidden
      // Converted value is still accepted so staff can save notes on that lead.
      if (status === "CONVERTED" && existingLead.status !== "CONVERTED") {
        throw new Error("Converted status is set automatically when a Repair Order is created.");
      }
      if (existingLead.status === "CONVERTED" && status !== "CONVERTED") {
        throw new Error("Converted and Completed leads are system-controlled.");
      }

      const result = await transaction.marketingLead.updateMany({
        where: { id, shopId: membership.shopId },
        data: { status, scheduledDate, scheduledTime, internalNote },
      });
      if (result.count !== 1) { stage = "not_found"; throw new Error("Lead was not found."); }

      const lead = await transaction.marketingLead.findFirstOrThrow({ where: { id, shopId: membership.shopId } });

      if (status === "SCHEDULED") {
        stage = "customer_link";
        const links = await transaction.$queryRaw<LeadCustomerLink[]>`
          SELECT customer_id
          FROM marketing_leads
          WHERE id = ${id}::uuid AND shop_id = ${membership.shopId}::uuid
        `;
        let customerId = links[0]?.customer_id ?? null;
        const leadName = normalizedCustomerName(lead.name);

        if (customerId) {
          const linkedCustomer = await transaction.customer.findFirst({
            where: { id: customerId, shopId: membership.shopId, archivedAt: null },
            select: { id: true, displayName: true },
          });
          if (!linkedCustomer || normalizedCustomerName(linkedCustomer.displayName) !== leadName) customerId = null;
        }

        const storedPhone = customerPhoneForStorage(lead.phone ?? "");

        if (!customerId && lead.email) {
          const emailCandidates = await transaction.customer.findMany({
            where: { shopId: membership.shopId, archivedAt: null, email: { equals: lead.email, mode: "insensitive" } },
            select: { id: true, displayName: true },
          });
          const emailMatch = emailCandidates.find((candidate) => normalizedCustomerName(candidate.displayName) === leadName);
          customerId = emailMatch?.id ?? null;
        }
        if (!customerId && storedPhone) {
          const phoneCandidates = await transaction.customer.findMany({
            where: { shopId: membership.shopId, archivedAt: null, OR: [{ phone: storedPhone }, { phone2: storedPhone }] },
            select: { id: true, displayName: true },
          });
          const phoneMatch = phoneCandidates.find((candidate) => normalizedCustomerName(candidate.displayName) === leadName);
          customerId = phoneMatch?.id ?? null;
        }

        if (!customerId) {
          const customer = await transaction.customer.create({
            data: {
              shopId: membership.shopId,
              displayName: lead.name.trim(),
              phone: storedPhone || null,
              email: lead.email?.trim() || null,
            },
            select: { id: true },
          });
          customerId = customer.id;
          await transaction.$executeRaw`
            UPDATE customers
            SET acquisition_source = 'WEB'
            WHERE id = ${customerId}::uuid AND shop_id = ${membership.shopId}::uuid
          `;
        }

        await transaction.$executeRaw`
          UPDATE marketing_leads
          SET customer_id = ${customerId}::uuid
          WHERE id = ${id}::uuid AND shop_id = ${membership.shopId}::uuid
        `;

        if (lead.vehicleYear && lead.vehicleMake?.trim() && lead.vehicleModel?.trim()) {
          const vehicleMatch = await transaction.vehicle.findFirst({
            where: {
              shopId: membership.shopId,
              customerId,
              archivedAt: null,
              year: lead.vehicleYear,
              make: { equals: lead.vehicleMake.trim(), mode: "insensitive" },
              model: { equals: lead.vehicleModel.trim(), mode: "insensitive" },
            },
            select: { id: true },
          });
          if (!vehicleMatch) {
            await transaction.vehicle.create({
              data: {
                shopId: membership.shopId,
                customerId,
                year: lead.vehicleYear,
                make: lead.vehicleMake.trim(),
                model: lead.vehicleModel.trim(),
              },
              select: { id: true },
            });
          }
        }
      }

      return lead;
    });
    console.info({ ...metadata, result: "persisted" });
    stage = "scheduling_email";
    if (status === "SCHEDULED") await notifyScheduledMarketingLead(updated);
    stage = "revalidation";
    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    revalidatePath("/customers");
    revalidatePath("/vehicles");
    revalidatePath("/dashboard");
  } catch {
    console.error({ ...metadata, result: "failed", stage });
    throw new Error("Could not save the lead. Please try again.");
  }
}
