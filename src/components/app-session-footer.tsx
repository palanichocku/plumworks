"use client";

import { useEffect, useMemo, useState } from "react";

export function AppSessionFooter({
  userEmail,
  system,
}: {
  userEmail: string;
  system: "DEV" | "PROD";
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const formattedDateTime = useMemo(() => {
    if (!now) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);
  }, [now]);

  return (
    <footer className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400 print:hidden">
      <span>{userEmail}</span>
      <span className="mx-2" aria-hidden="true">•</span>
      <span>System: {system}</span>
      {formattedDateTime ? (
        <>
          <span className="mx-2" aria-hidden="true">•</span>
          <span suppressHydrationWarning>{formattedDateTime}</span>
        </>
      ) : null}
    </footer>
  );
}
