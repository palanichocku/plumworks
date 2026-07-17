import { PermissionDenied } from "@/components/permission-denied";
import { AdminNavigation } from "@/components/admin-navigation";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "edit_shop_settings")) return <PermissionDenied />;

  return <><AdminNavigation />{children}</>;
}
