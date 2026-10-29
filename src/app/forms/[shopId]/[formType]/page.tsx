import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MarketingLeadSource } from "@/generated/prisma/client";
import { LeadForm } from "@/components/marketing/lead-form";
import { prisma } from "@/lib/prisma";

type HostedFormType = "contact" | "appointment" | "drop-off";

type HostedFormDefinition = {
  source: MarketingLeadSource;
  eyebrow: string;
  title: string;
  description: string;
};

const hostedForms: Record<HostedFormType, HostedFormDefinition> = {
  contact: {
    source: "CONTACT",
    eyebrow: "Contact the Shop",
    title: "How can we help?",
    description: "Send your contact information, vehicle details, and requested service. The shop will follow up with you.",
  },
  appointment: {
    source: "APPOINTMENT",
    eyebrow: "Request Service",
    title: "Request an appointment",
    description: "Choose a preferred service date and tell the shop what your vehicle needs. The shop will contact you to confirm availability.",
  },
  "drop-off": {
    source: "DROP_OFF",
    eyebrow: "Plan a Drop-Off",
    title: "Request a vehicle drop-off",
    description: "Share your preferred drop-off date and service need. Wait for confirmation and approved instructions before leaving your vehicle or keys.",
  },
};

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function findHostedFormShop(shopId: string) {
  if (shopId !== "current") {
    return prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, phone: true, city: true, state: true },
    });
  }

  // Convenience alias for local/Preview testing only. Production requires an
  // explicit shop identifier so requests can never become tenant-ambiguous.
  if (process.env.VERCEL_ENV === "production") return null;
  const shops = await prisma.shop.findMany({
    take: 2,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, phone: true, city: true, state: true },
  });
  return shops.length === 1 ? shops[0] : null;
}

export default async function HostedLeadFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopId: string; formType: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { shopId, formType } = await params;
  const definition = hostedForms[formType as HostedFormType];
  if (!definition) notFound();

  const shop = await findHostedFormShop(shopId);
  if (!shop) notFound();

  const query = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">{definition.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{definition.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{definition.description}</p>
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="font-black text-slate-900">{shop.name}</p>
            {(shop.city || shop.state) && <p className="mt-1 text-sm text-slate-600">{[shop.city, shop.state].filter(Boolean).join(", ")}</p>}
            {shop.phone && <a className="mt-1 inline-block text-sm font-bold text-orange-800 underline-offset-4 hover:underline" href={`tel:${shop.phone}`}>{shop.phone}</a>}
          </div>
        </header>

        <LeadForm
          source={definition.source}
          sent={query.sent === "1"}
          error={query.error}
          shopId={shop.id}
          shopName={shop.name}
        />

        <p className="mt-6 text-center text-xs font-semibold text-slate-400">Powered by PlumWorks</p>
      </div>
    </main>
  );
}
