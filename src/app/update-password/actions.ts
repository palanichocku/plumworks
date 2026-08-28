"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RECOVERY_CONTEXT_COOKIE, updateRecoveredPassword, type PasswordRecoveryState } from "@/lib/auth/password-recovery";
import { createClient } from "@/lib/supabase/server";

export async function updatePasswordAction(
  _previous: PasswordRecoveryState,
  formData: FormData,
): Promise<PasswordRecoveryState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const cookieStore = await cookies();
  const supabase = await createClient();
  const result = await updateRecoveredPassword(supabase, {
    password,
    confirmation,
    hasRecoveryContext: cookieStore.get(RECOVERY_CONTEXT_COOKIE)?.value === "1",
  });
  if (result.status === "error") return result;

  cookieStore.delete(RECOVERY_CONTEXT_COOKIE);
  await supabase.auth.signOut();
  redirect("/login?passwordReset=1");
}
