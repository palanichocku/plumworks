import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { RECOVERY_CONTEXT_COOKIE } from "@/lib/auth/password-recovery";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const forgotPassword = new URL("/forgot-password?error=invalid", request.url);
  if (!code || next !== "/update-password") return NextResponse.redirect(forgotPassword);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(forgotPassword);

  const cookieStore = await cookies();
  cookieStore.set(RECOVERY_CONTEXT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 15 * 60,
  });
  return NextResponse.redirect(new URL("/update-password", request.url));
}
