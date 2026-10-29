"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginActionState = {
  status: "idle" | "error";
  message?: string;
};

function loginErrorMessage(code?: string) {
  switch (code) {
    case "invalid_credentials":
      return "Invalid email or password.";
    case "captcha_failed":
      return "Sign-in verification failed. Please retry the verification and sign in again.";
    case "over_request_rate_limit":
      return "Too many sign-in attempts. Please wait a few minutes and try again.";
    case "email_not_confirmed":
      return "This account is not ready for sign-in. Please contact the administrator.";
    default:
      return "Unable to sign in right now. Please try again.";
  }
}

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const captchaToken = formData.get("captchaToken");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return { status: "error", message: "Enter both an email address and password." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      options:
        typeof captchaToken === "string" && captchaToken.trim()
          ? { captchaToken: captchaToken.trim() }
          : undefined,
    });

    if (error) {
      console.warn("Supabase sign-in failed", {
        code: error.code,
        status: error.status,
      });
      return { status: "error", message: loginErrorMessage(error.code) };
    }
  } catch {
    return {
      status: "error",
      message: "Unable to sign in right now. Please try again.",
    };
  }

  redirect("/dashboard");
}
