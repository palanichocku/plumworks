"use client";

import { useActionState, useRef, type ReactNode } from "react";
import toast from "react-hot-toast";
import { updateLeadStatus } from "@/app/(app)/leads/manage-actions";

type SaveState = "idle" | "saved" | "failed";

export function LeadManagementForm({ children }: { children: ReactNode }) {
  const submitting = useRef(false);
  const [state, action, pending] = useActionState<SaveState, FormData>(async (_previous, formData) => {
    try {
      await updateLeadStatus(formData);
      toast.success("Lead saved.");
      return "saved";
    } catch {
      toast.error("Could not save the lead. Please try again.");
      return "failed";
    } finally {
      submitting.current = false;
    }
  }, "idle");

  return <form action={action} onSubmit={(event) => {
    if (submitting.current) { event.preventDefault(); return; }
    submitting.current = true;
  }} aria-busy={pending} className="w-full shrink-0 rounded-xl bg-slate-50 p-4 lg:w-80">
    <fieldset disabled={pending} className="grid min-w-0 gap-3">
      <legend className="sr-only">Manage lead</legend>
      {children}
      <button disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving…" : "Save lead"}</button>
    </fieldset>
    <p role="status" aria-live="polite" className="mt-2 text-sm font-semibold">{pending ? "Saving lead…" : state === "saved" ? "Lead saved." : state === "failed" ? "Could not save the lead. Please try again." : ""}</p>
  </form>;
}
