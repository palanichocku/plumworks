import { redirect } from "next/navigation";
import { getShopSecuritySettings } from "@/lib/auth/shop-security-settings";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { MfaEnrollForm } from "./mfa-enroll-form";

export const dynamic = "force-dynamic";

export default async function MfaEnrollPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await prisma.shopMembership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { shopId: true },
  });

  if (!membership) redirect("/invite");

  const security = await getShopSecuritySettings(membership.shopId);
  if (!security.mfaRequired) redirect("/dashboard");

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;

  if (assurance.data.currentLevel === "aal2") redirect("/dashboard");
  if (assurance.data.nextLevel === "aal2") redirect("/mfa/challenge");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-primary">PlumWorks Security</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Set up Google Authenticator</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your shop requires multi-factor authentication. Set up an authenticator app once, then use its 6-digit code whenever you sign in.
        </p>
        <MfaEnrollForm />
      </section>
    </main>
  );
}
