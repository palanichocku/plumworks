import manifest from "@/config/cardoc-legacy-redirects.json";

const legacyHosts = new Set(manifest.legacyHosts);
const redirects = new Map(manifest.redirects.map((entry) => [entry.source, entry.destination]));
const attributionParameters = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid"]);

export function resolveCardocLegacyRedirect(input: URL, hostHeader?: string | null) {
  const host = (hostHeader || input.host).split(":")[0]?.toLowerCase();
  if (!host || !legacyHosts.has(host)) return null;
  const destination = redirects.get(input.pathname);
  if (!destination) return null;
  const target = new URL(destination, `https://${manifest.canonicalHostAfterCutover}`);
  for (const [name, value] of input.searchParams) if (attributionParameters.has(name)) target.searchParams.append(name, value);
  return { status: 301 as const, location: target };
}
