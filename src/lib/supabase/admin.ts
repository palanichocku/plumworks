import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Creates a privileged Auth client for server initiated staff invitations only. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase Auth Admin is not configured. Set the server-only SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
