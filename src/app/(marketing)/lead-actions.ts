"use server";

import { redirect } from "next/navigation";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyNewMarketingLead } from "@/lib/marketing-lead-notifications";

function field(formData: FormData, name: string, max: number) {
  return String(formData.get(name) ?? "").trim().slice(0, max) || null;
}

async function createLead(source: MarketingLeadSource, formData: FormData, destination: string) {
  if (field(formData, "website", 200)) redirect(`${destination}?sent=1`);
  const name = field(formData, "name", 120);
  const phone = field(formData, "phone", 40);
  const email = field(formData, "email", 200)?.toLowerCase() ?? null;
  const vehicleMake = field(formData, "vehicleMake", 80);
  const vehicleModel = field(formData, "vehicleModel", 80);
  const requestedService = field(formData, "requestedService", 200);
  const message = field(formData, "message", 3000);
  if (!name || !phone) redirect(`${destination}?error=1`);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`${destination}?error=1`);
  const rawYear = field(formData, "vehicleYear", 4);
  const year = rawYear ? Number(rawYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) redirect(`${destination}?error=1`);
  const rawDate = field(formData, "preferredDate", 10);
  const preferredDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  const preferredTime = field(formData, "preferredTime", 5);
  if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) redirect(`${destination}?error=1`);
  if (source === "CONTACT" && !message) redirect(`${destination}?error=1`);
  if (source === "APPOINTMENT" && (!year || !vehicleMake || !vehicleModel || !preferredDate || !requestedService)) redirect(`${destination}?error=1`);
  if (source === "DROP_OFF" && (!year || !vehicleMake || !vehicleModel || !requestedService)) redirect(`${destination}?error=1`);
  try {
    const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
    if (shops.length !== 1) redirect(`${destination}?error=1`);
    const lead = await prisma.marketingLead.create({ data: {
      shopId: shops[0].id, source, name, phone, email, vehicleYear: year,
      vehicleMake, vehicleModel, requestedService, preferredDate, preferredTime, message,
    } });
    await notifyNewMarketingLead(lead);
  } catch {
    redirect(`${destination}?error=1`);
  }
  redirect(`${destination}?sent=1`);
}

export async function submitContactLead(formData: FormData) { return createLead("CONTACT", formData, "/contact"); }
export async function submitAppointmentLead(formData: FormData) { return createLead("APPOINTMENT", formData, "/appointment"); }
export async function submitDropOffLead(formData: FormData) { return createLead("DROP_OFF", formData, "/drop-off"); }
