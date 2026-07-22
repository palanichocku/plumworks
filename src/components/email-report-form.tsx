"use client";

import { useState, useTransition } from "react";
// Ensure this path matches where you saved your action
import { sendReportEmail } from "@/lib/actions/email-reports"; 

export function EmailReportForm({ reportData }: { reportData: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  
  // useTransition allows us to manage the loading state of the Server Action
  const [isPending, startTransition] = useTransition();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("idle");
    
    startTransition(async () => {
      // Call the Server Action directly
      const result = await sendReportEmail(email, reportData);
      
      if (result.success) {
        setStatus("success");
        setEmail(""); // Clear the input on success
      } else {
        setStatus("error");
      }
    });
  };

  return (
    <form onSubmit={handleSend} className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label htmlFor="email-input" className="sr-only">
        Recipient Email
      </label>
      <input
        id="email-input"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter recipient email..."
        disabled={isPending}
        className="w-full sm:w-64 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isPending || !email}
        className="whitespace-nowrap rounded-lg bg-brand-primary px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-primary/90 focus:outline-none focus:ring-4 focus:ring-brand-primary/20 disabled:opacity-50"
      >
        {isPending ? "Sending..." : "Send Report"}
      </button>

      {/* Inline Status Feedback */}
      {status === "success" && (
        <span className="text-sm font-semibold text-emerald-600 animate-fadeIn">
          Sent successfully!
        </span>
      )}
      {status === "error" && (
        <span className="text-sm font-semibold text-red-600 animate-fadeIn">
          Delivery failed.
        </span>
      )}
    </form>
  );
}