import { redirect } from "next/navigation";
import { FormSubmitButton } from "@/components/form-submit-button";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { acceptStaffInvite } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await prisma.shopMembership.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (membership) redirect("/dashboard");
  const email = user.email?.trim().toLowerCase();
  const invite = email ? await prisma.staffInvite.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, status: "pending" },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, shop: { select: { name: true } } },
  }) : null;

  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12"><section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">{invite ? <><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle font-bold text-brand-primary">✓</div><h1 className="mt-6 text-2xl font-bold text-slate-950">Shop invitation</h1><p className="mt-3 text-sm leading-6 text-slate-600">You have been invited to join {invite.shop.name} as {invite.role.toLowerCase()}.</p><form action={acceptStaffInvite} className="mt-6"><input type="hidden" name="inviteId" value={invite.id} /><FormSubmitButton pendingLabel="Accepting…" className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Accept Invite</FormSubmitButton></form></> : <><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700">!</div><h1 className="mt-6 text-2xl font-bold text-slate-950">Access pending</h1><p className="mt-3 text-sm leading-6 text-slate-600">Your account is signed in, but no pending shop invitation matches it. Contact a shop administrator for access.</p></>}</section></main>;
}
