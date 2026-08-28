export const PASSWORD_RECOVERY_MESSAGE =
  "If an account exists for that email, password recovery instructions have been sent.";
export const RECOVERY_CONTEXT_COOKIE = "plumworks-password-recovery";

export type PasswordRecoveryState = {
  status: "idle" | "error";
  message?: string;
};

type RecoveryRequestClient = {
  auth: {
    resetPasswordForEmail(
      email: string,
      options: { redirectTo: string },
    ): Promise<{ error: unknown }>;
  };
};

type RecoveryUpdateClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
    updateUser(attributes: { password: string }): Promise<{ error: unknown }>;
  };
};

export function passwordRecoveryRedirect(origin: string) {
  const url = new URL("/auth/callback", origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Password recovery requires an HTTPS application origin.");
  }
  url.searchParams.set("next", "/update-password");
  return url.href;
}

export async function requestPasswordRecovery(
  client: RecoveryRequestClient,
  email: string,
  origin: string,
) {
  try {
    await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: passwordRecoveryRedirect(origin),
    });
  } catch {
    // The response must not reveal account existence or provider delivery details.
  }
  return PASSWORD_RECOVERY_MESSAGE;
}

export function validateRecoveredPassword(password: string, confirmation: string) {
  if (password !== confirmation) return "Password confirmation does not match.";
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 128) return "Password must be 128 characters or fewer.";
  return null;
}

export async function updateRecoveredPassword(
  client: RecoveryUpdateClient,
  input: { password: string; confirmation: string; hasRecoveryContext: boolean },
): Promise<PasswordRecoveryState | { status: "success" }> {
  if (!input.hasRecoveryContext) {
    return { status: "error", message: "This password recovery link is invalid or has expired." };
  }
  const validationError = validateRecoveredPassword(input.password, input.confirmation);
  if (validationError) return { status: "error", message: validationError };

  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) {
    return { status: "error", message: "This password recovery link is invalid or has expired." };
  }
  const { error } = await client.auth.updateUser({ password: input.password });
  if (error) {
    return { status: "error", message: "The password could not be updated. Request a new recovery link and try again." };
  }
  return { status: "success" };
}
