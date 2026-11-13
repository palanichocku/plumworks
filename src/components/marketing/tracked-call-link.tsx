"use client";

export function TrackedCallLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  function trackCallClick() {
    if (!href.startsWith("tel:")) return;
    try {
      // GA4 event records a button tap, not a completed or answered phone call.
      // Never attach a phone number or customer information to analytics events.
      const ga = window as typeof window & { gtag?: (...args: unknown[]) => void };
      ga.gtag?.("event", "call_button_click", { event_category: "site_engagement" });
    } catch {
      // Analytics must never interrupt the call action.
    }
    try {
      if (navigator.sendBeacon("/api/marketing/call-click")) return;
      void fetch("/api/marketing/call-click", { method: "POST", keepalive: true }).catch(() => undefined);
    } catch {
      return;
    }
  }

  return <a href={href} className={className} onClick={trackCallClick}>{children}</a>;
}
