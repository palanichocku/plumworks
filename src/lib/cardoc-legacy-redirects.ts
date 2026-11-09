import manifest from "@/config/cardoc-legacy-redirects.json";

const legacyHosts = new Set(manifest.legacyHosts);
const redirects = new Map(manifest.redirects.map((entry) => [entry.source, entry.destination]));
const attributionParameters = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]);

export function resolveCardocLegacyRedirect(input: URL, hostHeader?: string | null) {
  const host = (hostHeader || input.host).split(":")[0]?.toLowerCase();
  if (!host || !legacyHosts.has(host)) return null;
  // Google has retained an old appointment URL with a literal space instead of a hyphen.
  // URL.pathname represents that space as %20. Preserve all other legacy mappings.
  const pathname = input.pathname === "/Sterling%20Heights-appointment-request.php"
    ? "/Sterling-Heights-appointment-request.php"
    : input.pathname;
  const destination = redirects.get(pathname);
  if (!destination) return null;
  const target = new URL(destination, `https://${manifest.canonicalHostAfterCutover}`);
  for (const [name, value] of input.searchParams) if (attributionParameters.has(name)) target.searchParams.append(name, value);
  return { status: 301 as const, location: target };
}
