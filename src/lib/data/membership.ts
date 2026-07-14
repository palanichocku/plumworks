import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export const getCurrentMembership = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, membership: null };
  }

  const membership = await prisma.shopMembership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      shopId: true,
      shop: {
        select: {
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
        },
      },
    },
  });

  return { user, membership };
});
