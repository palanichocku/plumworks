"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginActionState = {
  status: "idle" | "error";
  message?: string;
};

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
      return { status: "error", message: "Invalid email or password." };
    }
  } catch {
    return {
      status: "error",
      message: "Unable to sign in right now. Please try again.",
    };
  }

  redirect("/dashboard");
}
