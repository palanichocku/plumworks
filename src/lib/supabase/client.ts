import { createBrowserClient } from "@supabase/ssr";

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  return { url, anonKey };
}

export function createClient() {
  const { url, anonKey } = getPublicSupabaseConfig();

  return createBrowserClient(url, anonKey);
}
