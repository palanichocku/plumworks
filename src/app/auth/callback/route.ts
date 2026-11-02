import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { RECOVERY_CONTEXT_COOKIE } from "@/lib/auth/password-recovery";
import { getAuthCallbackFlow } from "@/lib/auth/staff-invitation";
import { createClient } from "@/lib/supabase/server";

function callbackRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const flow = getAuthCallbackFlow(request.nextUrl.searchParams);
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const forgotPassword = new URL("/forgot-password?error=invalid", request.url);
  const inviteError = new URL("/login?invite=invalid", request.url);

  if (!flow) {
    return callbackRedirect(request.nextUrl.searchParams.get("flow") === "invite" ? inviteError : forgotPassword);
  }

  try {
    if (flow === "invite") {
      const supabase = await createClient();
      if (!tokenHash) return callbackRedirect(inviteError);
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
      if (error) return callbackRedirect(inviteError);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return callbackRedirect(inviteError);

      return callbackRedirect(new URL("/invite", request.url));
    }

    if (!code) return callbackRedirect(forgotPassword);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("Supabase public environment variables are not configured.");

    let authResponse = NextResponse.next();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            authResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return callbackRedirect(forgotPassword);

    const response = callbackRedirect(new URL("/update-password", request.url));
    authResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    response.cookies.set(RECOVERY_CONTEXT_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 15 * 60,
    });

    return response;
  } catch {
    return callbackRedirect(flow === "invite" ? inviteError : forgotPassword);
  }
}
