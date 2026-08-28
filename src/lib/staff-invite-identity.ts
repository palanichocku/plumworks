type InviteAuthIdentity = {
  email?: string | null;
  email_confirmed_at?: string | null;
};

export function confirmedInviteEmail(user: InviteAuthIdentity) {
  const email = user.email?.trim().toLowerCase();
  if (!email) throw new Error("A verified email address is required to accept an invitation.");
  if (!user.email_confirmed_at) {
    throw new Error("Confirm your email address before accepting this invitation.");
  }
  return email;
}
