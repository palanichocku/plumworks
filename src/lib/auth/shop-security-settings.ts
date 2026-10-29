import "server-only";

import { prisma } from "@/lib/prisma";

export type ShopSecuritySettings = {
  mfaRequired: boolean;
};

export async function getShopSecuritySettings(shopId: string): Promise<ShopSecuritySettings> {
  const rows = await prisma.$queryRaw<Array<{ mfaRequired: boolean }>>`
    SELECT mfa_required AS "mfaRequired"
    FROM shop_security_settings
    WHERE shop_id = ${shopId}::uuid
    LIMIT 1
  `;

  return {
    mfaRequired: rows[0]?.mfaRequired ?? false,
  };
}

export async function setShopMfaRequired(shopId: string, mfaRequired: boolean) {
  await prisma.$executeRaw`
    INSERT INTO shop_security_settings (shop_id, mfa_required, created_at, updated_at)
    VALUES (${shopId}::uuid, ${mfaRequired}, NOW(), NOW())
    ON CONFLICT (shop_id) DO UPDATE SET
      mfa_required = EXCLUDED.mfa_required,
      updated_at = NOW()
  `;
}
