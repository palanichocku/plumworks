"use server";

import { redirect } from "next/navigation";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

function field(formData: FormData, name: string, max: number) {
  return String(formData.get(name) ?? "").trim().slice(0, max) || null;
}

async function createLead(source: MarketingLeadSource, formData: FormData, destination: string) {
  if (field(formData, "website", 200)) redirect(`${destination}?sent=1`);
  const name = field(formData, "name", 120);
  const phone = field(formData, "phone", 40);
  const email = field(formData, "email", 200)?.toLowerCase() ?? null;
  if (!name || (!phone && !email)) throw new Error("Name and a phone number or email are required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
  if (shops.length !== 1) throw new Error("Lead capture is not configured.");
  const rawYear = field(formData, "vehicleYear", 4);
  const year = rawYear ? Number(rawYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) throw new Error("Enter a valid vehicle year.");
  const rawDate = field(formData, "preferredDate", 10);
  const preferredDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  await prisma.marketingLead.create({ data: {
    shopId: shops[0].id, source, name, phone, email, vehicleYear: year,
    vehicleMake: field(formData, "vehicleMake", 80), vehicleModel: field(formData, "vehicleModel", 80),
    requestedService: field(formData, "requestedService", 200), preferredDate, message: field(formData, "message", 3000),
  } });
  redirect(`${destination}?sent=1`);
}

export async function submitContactLead(formData: FormData) { return createLead("CONTACT", formData, "/contact"); }
export async function submitAppointmentLead(formData: FormData) { return createLead("APPOINTMENT", formData, "/appointment"); }
export async function submitDropOffLead(formData: FormData) { return createLead("DROP_OFF", formData, "/drop-off"); }
