import Link from "next/link";
import { DuplicateComparison } from "@/components/duplicate-comparison";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { findDuplicateCustomers, findDuplicateVehicles } from "@/lib/data/duplicates";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "export_shop_data")) return <PermissionDenied />;
  const [customerGroups, vehicleGroups] = await Promise.all([findDuplicateCustomers(membership.shopId), findDuplicateVehicles(membership.shopId)]);

  return <>
    <Link href="/admin/data-tools" className="text-sm font-semibold text-brand-primary hover:text-brand-primary">← Data Tools</Link>
    <div className="mt-5"><PageHeading eyebrow="Data quality" title="Duplicate Finder" description="Duplicates use strict matching to avoid false positives from common names or reused placeholder plates." /></div>
    <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">This page is read-only. Review records before merging or deleting. Merge/delete tools will be added later.</p>
    <DuplicateComparison customerGroups={customerGroups} vehicleGroups={vehicleGroups} />
  </>;
}
