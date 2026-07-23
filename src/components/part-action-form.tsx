"use client";

import { useActionState, type ReactNode } from "react";

export type PartActionState = { status: "idle" | "success" | "error"; message?: string };

const initialState: PartActionState = { status: "idle" };

export function PartActionForm({ action, className, children }: {
  action: (state: PartActionState, formData: FormData) => Promise<PartActionState>;
  className: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialState);
  return <form action={formAction} className={className}>
    {children}
    {state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 md:col-span-full">{state.message}</p>}
  </form>;
}
