"use server";
import { revalidatePath } from "next/cache";
import { MarketingLeadStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
const statuses = new Set(Object.values(MarketingLeadStatus));
export async function updateLeadStatus(formData: FormData) { const { membership } = await requirePermission("edit_shop_settings"); const id = String(formData.get("id") ?? ""); const status = String(formData.get("status") ?? "") as MarketingLeadStatus; if (!/^[0-9a-f-]{36}$/i.test(id) || !statuses.has(status)) throw new Error("Invalid lead update."); await prisma.marketingLead.updateMany({ where: { id, shopId: membership.shopId }, data: { status } }); revalidatePath("/admin/leads"); }
