import { redirect } from "next/navigation";
import { signOut } from "./actions";
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
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-12">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700">
            !
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-950">
            Access pending
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your account is signed in, but it has not been assigned to a shop.
            Contact a shop administrator for access.
          </p>
          <p className="mt-4 truncate text-sm font-medium text-slate-800">
            {user.email ?? "Signed-in user"}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-6 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <AppShell userEmail={user.email ?? "Signed-in user"} canViewReports={hasPermission(membership.role, "view_reports")} canViewSettings={hasPermission(membership.role, "edit_shop_settings")}>{children}</AppShell>;
}
