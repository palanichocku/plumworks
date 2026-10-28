"use client";

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

export function ShopRepresentativeSignatureSetting({ initialValue }: { initialValue: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.lineWidth = 2.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (value) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = value;
      }
    };

    render();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(render) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [value]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    drawing.current = true;
    lastPoint.current = next;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.arc(next.x, next.y, 1.25, 0, Math.PI * 2);
    context.fill();
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !lastPoint.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.beginPath();
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPoint.current = next;
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    event.preventDefault();
    drawing.current = false;
    lastPoint.current = null;
    setValue(event.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    drawing.current = false;
    lastPoint.current = null;
    setValue("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Default shop representative signature</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            This signature is prefilled on new invoice delivery acknowledgements. It can still be cleared or redrawn before the invoice signatures are recorded.
          </p>
        </div>
        <button type="button" onClick={clear} className="shrink-0 text-sm font-semibold text-brand-primary">
          Clear
        </button>
      </div>
      <input type="hidden" name="defaultShopRepresentativeSignatureData" value={value} />
      <canvas
        ref={canvasRef}
        aria-label="Default shop representative signature"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="mt-3 h-40 w-full rounded-xl border-2 border-slate-300 bg-white"
        style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
      />
      <p className="mt-2 text-xs text-slate-500">
        Sign once here using a finger, stylus, or mouse. Saving Invoice Defaults stores this as the shop default.
      </p>
    </section>
  );
}
