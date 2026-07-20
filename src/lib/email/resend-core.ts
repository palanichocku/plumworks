export type ResendAttachment = { filename: string; content: string };
export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; code: "missing_configuration" | "network_error" | "rate_limited" | "request_rejected" | "invalid_response"; message: string };

export async function sendResendEmail({
  to,
  subject,
  text,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: ResendAttachment[];
}, dependencies: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  from?: string;
} = {}): Promise<ResendSendResult> {
  const apiKey = dependencies.apiKey ?? process.env.RESEND_API_KEY?.trim();
  const from = dependencies.from ?? process.env.TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { ok: false, code: "missing_configuration", message: "Email delivery is not configured." };

  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(attachments?.length ? { attachments } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, code: "network_error", message: "The email service could not be reached." };
  }

  if (!response.ok) {
    return response.status === 429
      ? { ok: false, code: "rate_limited", message: "The email service is temporarily rate limited. Try again shortly." }
      : { ok: false, code: "request_rejected", message: response.status === 413 ? "The email attachment was rejected as too large." : "The email service rejected the request." };
  }
  try {
    const result = await response.json() as { id?: unknown };
    return typeof result.id === "string" && result.id ? { ok: true, id: result.id } : { ok: false, code: "invalid_response", message: "The email service returned an invalid response." };
  } catch {
    return { ok: false, code: "invalid_response", message: "The email service returned an invalid response." };
  }
}
