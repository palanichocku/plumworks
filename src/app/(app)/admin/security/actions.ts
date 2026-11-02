"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditEntry, writeAuditEntry } from "@/lib/audit";
import { setShopMfaRequired } from "@/lib/auth/shop-security-settings";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";

export async function updateSecuritySettings(formData: FormData) {
  const { user, membership } = await requirePermission("edit_shop_settings");

  if (membership.role !== "OWNER") {
    throw new Error("Only an owner can change login security settings.");
  }

  const mfaRequired = formData.get("mfaRequired") === "on";

  await setShopMfaRequired(membership.shopId, mfaRequired);

  await writeAuditEntry(
    prisma,
    auditEntry(
      membership.shopId,
      user?.id,
      "shop_security_settings_updated",
      "shop",
      membership.shopId,
      { source: "web", mfaRequired },
      {
        actorEmail: user?.email,
        actorRole: membership.role,
        entityLabel: membership.shop.name,
        entityHref: "/admin/security",
        contextSummary: mfaRequired
          ? "Authenticator app MFA required"
          : "Authenticator app MFA disabled",
      },
    ),
    { category: "governance" },
  );

  revalidatePath("/admin/security");
  redirect("/admin/security?saved=1");
}
