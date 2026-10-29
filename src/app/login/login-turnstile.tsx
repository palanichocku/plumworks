"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export function LoginTurnstile() {
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const element = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const allowSubmit = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const finish = useCallback((token: string) => {
    const form = formRef.current;
    if (!form) return;
    const field = form.querySelector<HTMLInputElement>('input[name="captchaToken"]');
    if (!field) return;

    field.value = token;
    setVerifying(false);
    setFailed(false);
    allowSubmit.current = true;
    form.requestSubmit();
  }, []);

  const fail = useCallback(() => {
    setVerifying(false);
    setFailed(true);
  }, []);

  const render = useCallback(() => {
    if (!sitekey || !element.current || !window.turnstile || widget.current !== null) return;
    widget.current = window.turnstile.render(element.current, {
      sitekey,
      action: "LOGIN",
      execution: "execute",
      appearance: "interaction-only",
      theme: "light",
      callback: finish,
      "expired-callback": fail,
      "error-callback": fail,
      "timeout-callback": fail,
    });
  }, [fail, finish, sitekey]);

  useEffect(() => {
    const form = element.current?.closest("form");
    if (!form || !sitekey) return;
    formRef.current = form;

    const submit = (event: SubmitEvent) => {
      if (allowSubmit.current) {
        allowSubmit.current = false;
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (!widget.current || !window.turnstile || verifying) return;

      const field = form.querySelector<HTMLInputElement>('input[name="captchaToken"]');
      if (field) field.value = "";
      setFailed(false);
      setVerifying(true);

      try {
        window.turnstile.reset(widget.current);
        window.turnstile.execute(widget.current);
      } catch {
        fail();
      }
    };

    form.addEventListener("submit", submit, true);
    return () => {
      form.removeEventListener("submit", submit, true);
      formRef.current = null;
    };
  }, [fail, sitekey, verifying]);

  useEffect(() => {
    render();
    return () => {
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [render]);

  if (!sitekey) return <input type="hidden" name="captchaToken" value="" readOnly />;

  return (
    <>
      <input type="hidden" name="captchaToken" defaultValue="" />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={render}
        onError={fail}
      />
      <div ref={element} className="min-h-0" />
      {verifying ? <p role="status" className="text-center text-sm text-slate-500">Verifying sign-in…</p> : null}
      {failed ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">Security verification could not finish. Please try signing in again.</p> : null}
    </>
  );
}
