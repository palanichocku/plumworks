import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let access;

  try {
    access = await getCurrentMembership();
  } catch {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Unable to load shop access
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The shop connection is temporarily unavailable. Please try again.
          </p>
        </section>
      </main>
    );
  }

  const { user, membership } = access;

  if (!user) {
    redirect("/login");
  }

  if (!membership) {
    redirect("/invite");
  }

  return <AppShell shopName={membership.shop.name} userEmail={user.email ?? "Signed-in user"} canViewReports={hasPermission(membership.role, "view_reports")} canViewAdmin={hasPermission(membership.role, "edit_shop_settings")}>{children}</AppShell>;
}
