"use client";

import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { sendDailySalesReportEmail } from "@/lib/actions/email-reports";

interface EmailPdfFormProps {
  fromDate: string;
  toDate: string;
}

export function EmailPdfForm({ fromDate, toDate }: EmailPdfFormProps) {
  const [emailValue, setEmailValue] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!emailValue) return;

    setIsSending(true);

    try {
      const result = await sendDailySalesReportEmail(emailValue, fromDate, toDate);
      
      if (result.success) {
        toast.success("PDF report sent successfully!");
        setEmailValue(""); 
      } else {
        toast.error(result.error || "Failed to send report.");
      }
    } catch (error) {
      toast.error("An unexpected error occurred.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={handleEmailSubmit} className="flex items-center gap-3">
      <input
        type="email"
        placeholder="Email address..."
        value={emailValue}
        onChange={(e) => setEmailValue(e.target.value)}
        required
        className="w-64 px-4 py-2 text-sm font-bold text-slate-900 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white placeholder:text-slate-400 placeholder:font-medium"
        disabled={isSending}
      />
      <button
        type="submit"
        disabled={isSending}
        className="px-5 py-2 text-sm font-bold text-white bg-brand-primary border-2 border-brand-primary rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 transition-colors shadow-sm"
      >
        {isSending ? "Sending..." : "Email PDF"}
      </button>
    </form>
  );
}