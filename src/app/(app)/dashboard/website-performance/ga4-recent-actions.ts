"use server";

import { requirePermission } from "@/lib/permissions";
import { getGa4RecentVisitors } from "@/lib/ga4-visitor-report";

// Never fetch GA4 recent activity during the page's initial server render.
// Only the authenticated, user-initiated switch or Refresh button calls this action.
export async function loadRecentGa4Visitors() {
  await requirePermission("view_reports");
  return getGa4RecentVisitors();
}
