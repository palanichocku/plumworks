import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { AdminTabs } from "./admin-tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  return (
    <div className="mx-auto w-full max-w-6xl animate-fadeIn">
      <div className="mb-6 pt-2">
        <h1 className="text-xs font-black tracking-widest text-slate-400 uppercase mb-1">
          Management
        </h1>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">
          Admin Control Panel
        </h2>
      </div>

      <AdminTabs />

      <main>
        {children}
      </main>
    </div>
  );
}