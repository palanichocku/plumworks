import "server-only";

function canonicalDomain(value: string) {
  // A final DNS root dot (or repeated final dots accepted by the form parser)
  // must not make an otherwise blocked domain compare differently.
  return value.trim().toLowerCase().replace(/\.+$/u, "");
}

export function isBlockedLeadEmailDomain(email: string, configuration = process.env.PUBLIC_LEAD_BLOCKED_EMAIL_DOMAINS) {
  const domain = canonicalDomain(email.slice(email.lastIndexOf("@") + 1));
  return (configuration ?? "").split(",").map(canonicalDomain).filter(Boolean)
    .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}
