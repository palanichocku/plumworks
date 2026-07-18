import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";

export const marketingContentTablesAvailable = cache(async () => {
  try {
    const rows = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT to_regclass('public.marketing_settings') IS NOT NULL
        AND to_regclass('public.marketing_services') IS NOT NULL AS available
    `;
    return rows[0]?.available === true;
  } catch {
    return false;
  }
});
