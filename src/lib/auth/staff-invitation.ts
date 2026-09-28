type InvitationAdminClient = {
  auth: {
    admin: {
      inviteUserByEmail(email: string, options: { redirectTo: string }): Promise<{ error: unknown }>;
    };
  };
};

export function staffInvitationRedirect(origin: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    throw new Error("Staff invitations require an HTTPS application origin.");
  }
  const redirect = new URL("/auth/callback", base);
  redirect.searchParams.set("flow", "invite");
  redirect.searchParams.set("next", "/invite");
  return redirect.href;
}

export type StaffInvitationResult = { status: "sent" } | { status: "existing_account" } | { status: "failed" };

export async function sendStaffAuthInvitation(
  client: InvitationAdminClient,
  email: string,
  origin: string,
): Promise<StaffInvitationResult> {
  try {
    const { error } = await client.auth.admin.inviteUserByEmail(email, {
      redirectTo: staffInvitationRedirect(origin),
    });
    // Auth can resend invitations to unconfirmed identities. Confirmed identities
    // must keep their existing UUID and sign in (or use normal password recovery).
    if (error && typeof error === "object" && "code" in error && error.code === "email_exists") {
      return { status: "existing_account" };
    }
    return error ? { status: "failed" } : { status: "sent" };
  } catch {
    return { status: "failed" };
  }
}

export type AuthCallbackFlow = "invite" | "recovery";

export function getAuthCallbackFlow(params: URLSearchParams): AuthCallbackFlow | null {
  if (["next", "flow", "code", "token_hash", "type"].some((key) => params.getAll(key).length > 1)) return null;
  if (params.has("error") || params.has("error_code")) return null;
  const next = params.get("next");
  const flow = params.get("flow");
  const hasInviteToken = Boolean(params.get("token_hash")) && params.get("type") === "invite";
  // Admin invitations do not support PKCE. Never relabel an arbitrary code as an invite.
  if (next === "/invite" && flow === "invite" && hasInviteToken && !params.has("code")) return "invite";
  if (params.get("code") && !params.has("token_hash") && !params.has("type") && next === "/update-password" && (flow === null || flow === "recovery")) return "recovery";
  return null;
}
