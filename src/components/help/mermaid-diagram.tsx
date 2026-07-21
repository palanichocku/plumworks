"use client";

import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ title, chart }: { title: string; chart: string }) {
  const reactId = useId();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    async function render() {
      try {
        setFailed(false);
        const { default: mermaid } = await import("mermaid");
        const dark = document.documentElement.classList.contains("dark") || media.matches;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "base",
          themeVariables: dark
            ? { primaryColor: "#0c4a6e", primaryTextColor: "#f8fafc", lineColor: "#38bdf8", background: "#0f172a" }
            : { primaryColor: "#e0f2fe", primaryTextColor: "#0f172a", lineColor: "#0284c7", background: "#ffffff" },
          flowchart: { htmlLabels: true, curve: "basis" },
        });
        const id = `help-mermaid-${reactId.replaceAll(":", "")}`;
        const result = await mermaid.render(id, chart);
        if (active) setSvg(result.svg);
      } catch {
        if (active) {
          setSvg("");
          setFailed(true);
        }
      }
    }

    void render();
    media.addEventListener("change", render);
    return () => {
      active = false;
      media.removeEventListener("change", render);
    };
  }, [chart, reactId]);

  return <figure className="overflow-hidden rounded-2xl border border-brand-primary/30 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><figcaption className="border-b border-brand-subtle bg-brand-subtle px-5 py-3 text-sm font-bold uppercase tracking-wider text-brand-primary dark:border-slate-700 dark:bg-slate-800 dark:text-brand-primary/30">{title}</figcaption><div className="min-h-48 overflow-x-auto p-5">{failed ? <div role="status" className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-900">This workflow diagram could not be displayed. Refresh the page or review the written steps below.</div> : svg ? <div aria-label={title} role="img" className="min-w-[700px] [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div role="status" className="flex min-h-36 items-center justify-center text-sm text-slate-500">Rendering workflow diagram…</div>}</div></figure>;
}
