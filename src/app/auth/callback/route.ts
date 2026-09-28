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
  const cookieStore = await cookies();
  cookieStore.delete(RECOVERY_CONTEXT_COOKIE);
  if (!flow) return callbackRedirect(request.nextUrl.searchParams.get("flow") === "invite" ? inviteError : forgotPassword);

  try {
    const supabase = await createClient();
    if (flow === "invite") {
      if (!tokenHash) return callbackRedirect(inviteError);
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
      if (error) return callbackRedirect(inviteError);
    } else {
      if (!code) return callbackRedirect(forgotPassword);
      // The SDK emits this event only for a recovery PKCE verifier.
      let recoverySession = false;
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") recoverySession = true;
      });
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !recoverySession) return callbackRedirect(forgotPassword);
      } finally {
        subscription.unsubscribe();
      }
    }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return callbackRedirect(flow === "invite" ? inviteError : forgotPassword);
  } catch {
    return callbackRedirect(flow === "invite" ? inviteError : forgotPassword);
  }

  if (flow === "invite") return callbackRedirect(new URL("/invite", request.url));

  cookieStore.set(RECOVERY_CONTEXT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 15 * 60,
  });
  return callbackRedirect(new URL("/update-password", request.url));
}
