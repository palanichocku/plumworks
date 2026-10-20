export type DevEmailSafetyResult<T> =
  | { ok: true; message: T }
  | { ok: false; message: string };

function isDevVercelPreview() {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "dev"
  );
}

function validEmail(value: string) {
  return (
    value.length <= 254 &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function applyDevEmailSafety<T extends { to: string; subject: string }>(
  message: T,
): DevEmailSafetyResult<T> {
  if (!isDevVercelPreview()) return { ok: true, message };

  const redirectTo = process.env.DEV_EMAIL_REDIRECT_TO?.trim().toLowerCase();
  if (!redirectTo || !validEmail(redirectTo)) {
    return {
      ok: false,
      message:
        "DEV email delivery is disabled until a valid DEV_EMAIL_REDIRECT_TO is configured.",
    };
  }

  return {
    ok: true,
    message: {
      ...message,
      to: redirectTo,
      subject: `[DEV] ${message.subject}`,
    },
  };
}
