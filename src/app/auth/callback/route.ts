import { cookies } from "next/headers";
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
    const supabase = await createClient();

    if (flow === "invite") {
      if (!tokenHash) return callbackRedirect(inviteError);
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
      if (error) return callbackRedirect(inviteError);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return callbackRedirect(inviteError);

      return callbackRedirect(new URL("/invite", request.url));
    }

    if (!code) return callbackRedirect(forgotPassword);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return callbackRedirect(forgotPassword);

    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_CONTEXT_COOKIE, "1", {
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 15 * 60,
    });

    return callbackRedirect(new URL("/update-password", request.url));
  } catch {
    return callbackRedirect(flow === "invite" ? inviteError : forgotPassword);
  }
}
