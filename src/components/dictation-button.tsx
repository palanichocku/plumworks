"use client";

import { useEffect, useRef, useState } from "react";

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type SpeechRecognitionErrorEventLike = { error?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function insertTranscript(value: string, transcript: string, start: number, end: number) {
  const spoken = transcript.trim().toUpperCase();
  if (!spoken) return { value, caret: start };

  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const suffix = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const inserted = `${prefix}${spoken}${suffix}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

export function DictationButton({ textareaId, value, onChange, className = "" }: {
  textareaId: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const selectionRef = useRef({ start: value.length, end: value.length });
  const valueRef = useRef(value);
  const keepListeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = Boolean(getSpeechRecognition());

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => () => {
    keepListeningRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.abort();
  }, []);

  function speak() {
    setMessage(null);
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (textarea) {
      selectionRef.current = {
        start: textarea.selectionStart ?? valueRef.current.length,
        end: textarea.selectionEnd ?? valueRef.current.length,
      };
    }

    if (listening) {
      keepListeningRef.current = false;
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setMessage("Speech input is not supported in this browser.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal !== false) transcript += result?.[0]?.transcript ?? "";
      }
      if (!transcript.trim()) return;
      const { start, end } = selectionRef.current;
      const inserted = insertTranscript(valueRef.current, transcript, start, end);
      valueRef.current = inserted.value;
      selectionRef.current = { start: inserted.caret, end: inserted.caret };
      onChange(inserted.value);
      window.requestAnimationFrame(() => {
        const current = document.getElementById(textareaId) as HTMLTextAreaElement | null;
        current?.focus();
        current?.setSelectionRange(inserted.caret, inserted.caret);
      });
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        keepListeningRef.current = false;
        setMessage("Microphone access is blocked. Allow microphone access in the browser and try again.");
      } else if (event.error !== "aborted") {
        keepListeningRef.current = false;
        setMessage("Speech input stopped unexpectedly. Please try again.");
      }
      if (!keepListeningRef.current) setListening(false);
    };
    recognition.onend = () => {
      if (keepListeningRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          if (!keepListeningRef.current || recognitionRef.current !== recognition) return;
          try {
            recognition.start();
          } catch {
            keepListeningRef.current = false;
            recognitionRef.current = null;
            setListening(false);
            setMessage("Speech input could not continue. Please press Speak to try again.");
          }
        }, 150);
        return;
      }
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    setListening(true);
    try {
      recognition.start();
    } catch {
      keepListeningRef.current = false;
      setListening(false);
      recognitionRef.current = null;
      setMessage("Speech input could not start. Please try again.");
    }
  }

  return <span className={`inline-flex flex-col items-end ${className}`}>
    <button type="button" onClick={speak} disabled={!supported && !message} aria-pressed={listening} title={supported ? "Dictate text" : "Speech input is not supported in this browser"} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-subtle focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:cursor-not-allowed disabled:text-slate-400">
      <MicIcon />{listening ? "Stop listening" : "Speak"}
    </button>
    {message ? <span role="status" className="mt-1 max-w-72 text-right text-[11px] font-normal text-slate-500">{message}</span> : null}
  </span>;
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg>;
}
