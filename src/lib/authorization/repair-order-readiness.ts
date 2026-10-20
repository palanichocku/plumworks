import "server-only";

import { prisma } from "@/lib/prisma";
import { getRepairOrderAuthorizationSummaryForShop } from "@/lib/authorization/repair-order-evidence";

export async function getSavedCurrentRepairOrderRevision(shopId: string, repairOrderId: string) {
  const summary = await getRepairOrderAuthorizationSummaryForShop(shopId, repairOrderId);
  if (!summary) return null;

  const rows = await prisma.$queryRaw<Array<{ id: string; revision: number; snapshotSha256: string }>>`
    SELECT id, revision, snapshot_sha256 AS "snapshotSha256"
    FROM document_revisions
    WHERE shop_id = ${shopId}::uuid
      AND document_type = 'REPAIR_ORDER'::"DocumentEvidenceType"
      AND document_id = ${repairOrderId}::uuid
      AND snapshot_sha256 = ${summary.currentSnapshotSha256}
    ORDER BY revision DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function isRepairOrderReadyForAuthorization(shopId: string, repairOrderId: string) {
  return Boolean(await getSavedCurrentRepairOrderRevision(shopId, repairOrderId));
}
