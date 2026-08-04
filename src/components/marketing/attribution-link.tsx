"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const attributionParameters = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid",
]);

export function AttributionLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const current = useSearchParams();
  const [pathname, existingQuery = ""] = href.split("?", 2);
  const query = new URLSearchParams(existingQuery);
  for (const [key, value] of current.entries()) {
    if (attributionParameters.has(key) && !query.has(key)) query.append(key, value);
  }
  const attributedHref = query.size ? `${pathname}?${query.toString()}` : pathname;
  return <Link href={attributedHref} className={className}>{children}</Link>;
}
