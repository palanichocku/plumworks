"use client";

export function TrackedCallLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  function trackCallClick() {
    if (!href.startsWith("tel:")) return;
    try {
      if (navigator.sendBeacon("/api/marketing/call-click")) return;
      void fetch("/api/marketing/call-click", { method: "POST", keepalive: true }).catch(() => undefined);
    } catch {
      return;
    }
  }

  return <a href={href} className={className} onClick={trackCallClick}>{children}</a>;
}
