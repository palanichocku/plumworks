"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

export type PartActionState = { status: "idle" | "success" | "error"; message?: string };

const initialState: PartActionState = { status: "idle" };

export function PartActionForm({ action, className, children, onSuccess }: {
  action: (state: PartActionState, formData: FormData) => Promise<PartActionState>;
  className: string;
  children: ReactNode;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { if (state.status === "success") onSuccessRef.current?.(); }, [state]);
  return <form action={formAction} className={className}>
    {children}
    <div aria-live="polite" className="sm:col-span-full">{state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{state.message}</p>}{state.status === "success" && <p className="text-sm font-medium text-emerald-700">Saved.</p>}</div>
  </form>;
}
