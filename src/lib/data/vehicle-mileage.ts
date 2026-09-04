import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LastRecordedMileage = { vehicleId: string; mileage: number; recordedAt: Date };

export async function getLastRecordedMileageForVehicles(shopId: string, vehicleIds: string[]) {
  if (vehicleIds.length === 0) return new Map<string, LastRecordedMileage>();
  const rows = await prisma.$queryRaw<LastRecordedMileage[]>(Prisma.sql`
    SELECT DISTINCT ON (vehicle_id)
      vehicle_id AS "vehicleId",
      odometer AS mileage,
      CASE WHEN legacy_source_table IS NULL THEN closed_at ELSE invoice_date END AS "recordedAt"
    FROM invoices
    WHERE shop_id = ${shopId}::uuid
      AND vehicle_id IN (${Prisma.join(vehicleIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND odometer IS NOT NULL
      AND (
        (legacy_source_table IS NULL AND status = 'closed' AND closed_at IS NOT NULL)
        OR (legacy_source_table IS NOT NULL AND invoice_date IS NOT NULL)
      )
    ORDER BY vehicle_id, "recordedAt" DESC
  `);
  return new Map(rows.map((row) => [row.vehicleId, row]));
}

export async function getLastRecordedMileageForVehicle(shopId: string, vehicleId: string) {
  return (await getLastRecordedMileageForVehicles(shopId, [vehicleId])).get(vehicleId) ?? null;
}
