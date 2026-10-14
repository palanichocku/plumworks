"use client";

import { useRouter } from "next/navigation";

export function AuthorizationEvidenceBackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  function goBack() {
    try {
      if (document.referrer) {
        const referrer = new URL(document.referrer);
        if (referrer.origin === window.location.origin) {
          router.back();
          return;
        }
      }
    } catch {
      // Fall through to the safe in-app destination.
    }

    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="text-sm font-semibold text-brand-primary print:hidden"
    >
      ← Back
    </button>
  );
}
