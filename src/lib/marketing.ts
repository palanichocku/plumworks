import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";

export type PublicShop = {
  id: string | null;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  hours: string;
};

export const getPublicShop = cache(async (): Promise<PublicShop> => {
  try {
    const shops = await prisma.shop.findMany({
      take: 2,
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true },
    });
    if (shops.length !== 1) throw new Error("Public website requires exactly one configured shop.");
    return { ...shops[0], hours: process.env.PLUMWORKS_PUBLIC_HOURS?.trim() || "Monday–Friday, 8:00 AM–5:30 PM" };
  } catch {
    return {
      id: null,
      name: "Your Local Repair Shop",
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      hours: process.env.PLUMWORKS_PUBLIC_HOURS?.trim() || "Call for current hours",
    };
  }
});

export function shopAddress(shop: PublicShop) {
  return [shop.addressLine1, [shop.city, shop.state].filter(Boolean).join(", "), shop.postalCode].filter(Boolean).join(" ");
}

export function phoneHref(phone: string | null) {
  const digits = phone?.replaceAll(/[^\d+]/g, "") ?? "";
  return digits ? `tel:${digits}` : "/contact";
}
