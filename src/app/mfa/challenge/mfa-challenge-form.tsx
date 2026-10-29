"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MfaChallengeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);

    try {
      const supabase = createClient();
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;

      const factor = factors.data.totp[0];
      if (!factor) {
        router.replace("/mfa/enroll");
        router.refresh();
        return;
      }

      const verification = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verification.error) throw verification.error;

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("That code could not be verified. Enter the current 6-digit code from Google Authenticator.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="mt-6 space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">6-digit authenticator code</span>
        <input
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void verify();
            }
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-xl tracking-[0.35em] text-slate-950 outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-subtle"
        />
      </label>

      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={verify}
        disabled={busy || code.length !== 6}
        className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Verifying…" : "Verify and sign in"}
      </button>

      <button type="button" onClick={signOut} className="w-full text-sm font-medium text-slate-500 hover:text-slate-700">
        Sign out
      </button>
    </div>
  );
}
