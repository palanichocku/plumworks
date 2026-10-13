"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  recordInvoiceDeliverySignaturesAction,
  type InvoiceSignatureActionState,
} from "@/app/(app)/invoices/signature-actions";
import {
  CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_TEXT,
  SHOP_DELIVERY_ACKNOWLEDGEMENT_TEXT,
} from "@/lib/authorization/invoice-signature-copy";

const initial: InvoiceSignatureActionState = { status: "idle" };

function SignaturePad({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return;

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.lineWidth = 2.5;
      context.lineCap = "round";
      context.lineJoin = "round";

      if (value) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = value;
      }
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [value]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    lastPoint.current = point(event);
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
    onChange(event.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-900">{label}</label>
        <button type="button" onClick={clear} className="text-sm font-semibold text-brand-primary">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={label}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="mt-2 h-52 w-full touch-none rounded-xl border-2 border-slate-300 bg-white"
      />
      <p className="mt-1 text-xs text-slate-500">Sign inside the box using a finger, stylus, or mouse.</p>
    </div>
  );
}

export function InvoiceDeliverySignatureCapture({
  invoiceId,
  invoiceNumber,
  vehicleLabel,
  totalLabel,
  defaultCustomerName,
}: {
  invoiceId: string;
  invoiceNumber: string;
  vehicleLabel: string;
  totalLabel: string;
  defaultCustomerName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<InvoiceSignatureActionState>(initial);
  const [customerSignature, setCustomerSignature] = useState("");
  const [shopSignature, setShopSignature] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setState(initial);
    if (!customerSignature || !shopSignature) {
      setState({ status: "error", message: "Both signatures are required." });
      return;
    }

    formData.set("customerSignatureData", customerSignature);
    formData.set("shopRepresentativeSignatureData", shopSignature);

    startTransition(async () => {
      const result = await recordInvoiceDeliverySignaturesAction(initial, formData);
      setState(result);
      if (result.status === "success") {
        router.replace(`/invoices/${invoiceId}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-24">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-primary">Vehicle delivery</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950 sm:text-3xl">Capture Delivery Signatures</h1>
          <p className="mt-2 text-sm text-slate-600">
            {invoiceNumber} · {vehicleLabel} · Final total {totalLabel}
          </p>
        </div>
        <Link
          href={`/invoices/${invoiceId}`}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Cancel
        </Link>
      </div>

      <form action={submit} className="space-y-6">
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-950">1. Customer acknowledgement</h2>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_TEXT}
          </p>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            Customer printed name
            <input
              name="customerName"
              defaultValue={defaultCustomerName}
              required
              minLength={2}
              maxLength={120}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-3 text-base"
            />
          </label>
          <div className="mt-5">
            <SignaturePad label="Customer signature" value={customerSignature} onChange={setCustomerSignature} />
          </div>
          <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-slate-700">
            <input type="checkbox" name="customerConsentAccepted" required className="mt-1.5 h-4 w-4 shrink-0" />
            <span>I have reviewed the acknowledgement above and agree that this electronic signature represents my signature.</span>
          </label>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-950">2. Shop representative acknowledgement</h2>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {SHOP_DELIVERY_ACKNOWLEDGEMENT_TEXT}
          </p>
          <label className="mt-4 block text-sm font-semibold text-slate-800">
            Shop representative printed name
            <input
              name="shopRepresentativeName"
              required
              minLength={2}
              maxLength={120}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-3 text-base"
            />
          </label>
          <div className="mt-5">
            <SignaturePad label="Shop representative signature" value={shopSignature} onChange={setShopSignature} />
          </div>
          <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-slate-700">
            <input type="checkbox" name="shopConsentAccepted" required className="mt-1.5 h-4 w-4 shrink-0" />
            <span>I confirm the acknowledgement above and agree that this electronic signature represents my signature.</span>
          </label>
        </section>

        {state.status === "error" ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {state.message}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-3 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 px-3 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
          <Link
            href={`/invoices/${invoiceId}`}
            className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Recording…" : "Accept & Record Both Signatures"}
          </button>
        </div>
      </form>
    </div>
  );
}
