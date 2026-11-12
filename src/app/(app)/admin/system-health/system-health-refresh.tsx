"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SystemHealthRefresh({ updatedAtIso }: { updatedAtIso: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const previousUpdatedAt = useRef(updatedAtIso);

  useEffect(() => {
    if (previousUpdatedAt.current !== updatedAtIso) {
      previousUpdatedAt.current = updatedAtIso;
      if (refreshRequested) {
        setLastCompleted(updatedAtIso);
        setRefreshRequested(false);
      }
    }
  }, [updatedAtIso, refreshRequested]);

  function refresh() {
    setLastCompleted(null);
    setRefreshRequested(true);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={pending || refreshRequested}
        aria-busy={pending || refreshRequested}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-70"
      >
        <span aria-hidden="true" className={pending || refreshRequested ? "inline-block animate-spin" : ""}>↻</span>
        {pending || refreshRequested ? "Refreshing…" : "Refresh"}
      </button>
      <span role="status" aria-live="polite" className="text-xs font-medium text-slate-600">
        {pending || refreshRequested
          ? "Checking latest system health…"
          : lastCompleted
            ? "Updated successfully"
            : ""}
      </span>
    </div>
  );
}
