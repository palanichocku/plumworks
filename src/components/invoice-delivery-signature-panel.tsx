"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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

type SignatureRecord = {
  eventId: string;
  sessionId: string;
  role: "CUSTOMER" | "SHOP_REPRESENTATIVE";
  signerName: string;
  occurredAt: string;
  staffUserEmail: string | null;
  signatureData: string;
  signatureSha256: string;
  revision: number;
  snapshotSha256: string;
};

function shortHash(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-12)}` : value;
}

function SignaturePad({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
      if (canvas.width === Math.round(rect.width * ratio) && canvas.height === Math.round(rect.height * ratio)) return;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
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
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
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

  return <div>
    <div className="flex items-center justify-between gap-3">
      <label className="text-sm font-semibold text-slate-900">{label}</label>
      <button type="button" onClick={clear} className="text-sm font-semibold text-brand-primary">Clear</button>
    </div>
    <canvas
      ref={canvasRef}
      aria-label={label}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      className="mt-2 h-44 w-full touch-none rounded-xl border-2 border-slate-300 bg-white"
    />
    <p className="mt-1 text-xs text-slate-500">Sign inside the box using a finger, stylus, or mouse.</p>
  </div>;
}

export function InvoiceDeliverySignaturePanel({
  invoiceId,
  invoiceNumber,
  vehicleLabel,
  totalLabel,
  defaultCustomerName,
  currentComplete,
  signatures,
}: {
  invoiceId: string;
  invoiceNumber: string;
  vehicleLabel: string;
  totalLabel: string;
  defaultCustomerName: string;
  currentComplete: boolean;
  signatures: SignatureRecord[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InvoiceSignatureActionState>(initial);
  const [customerSignature, setCustomerSignature] = useState("");
  const [shopSignature, setShopSignature] = useState("");
  const [pending, startTransition] = useTransition();

  const sessions = Array.from(new Set(signatures.map((row) => row.sessionId))).map((sessionId) => ({
    sessionId,
    rows: signatures.filter((row) => row.sessionId === sessionId),
  }));

  function submit(formData: FormData) {
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
        setOpen(false);
        setCustomerSignature("");
        setShopSignature("");
        router.refresh();
      }
    });
  }

  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Vehicle Delivery Signatures</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={currentComplete ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800" : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"}>
            {currentComplete ? "Customer + shop signatures on file" : "Signatures not yet captured"}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">Two immutable signatures are retained with the exact invoice revision: the customer and the shop representative who completes delivery.</p>
      </div>
      {!currentComplete ? <button type="button" onClick={() => { setState(initial); setOpen(true); }} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">Capture Delivery Signatures</button> : null}
    </div>

    {sessions.length ? <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">{sessions.map((session) => {
      const revision = session.rows[0]?.revision;
      const snapshotHash = session.rows[0]?.snapshotSha256;
      return <article key={session.sessionId} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900">Delivery signature set · Invoice revision {revision}</p>
          <p className="font-mono text-[10px] text-slate-500" title={snapshotHash}>Integrity ID {snapshotHash ? shortHash(snapshotHash) : "—"}</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{session.rows.map((row) => <div key={row.eventId} className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{row.role === "CUSTOMER" ? "Customer" : "Shop Representative"}</p>
          <p className="mt-1 font-semibold text-slate-950">{row.signerName}</p>
          <img src={row.signatureData} alt={`${row.signerName} signature`} className="mt-3 h-28 w-full rounded-lg border border-slate-200 bg-white object-contain" />
          <p className="mt-2 text-xs text-slate-500">Signed {new Date(row.occurredAt).toLocaleString()}</p>
          {row.staffUserEmail ? <p className="mt-1 break-all text-xs text-slate-500">Recorded by {row.staffUserEmail}</p> : null}
          <p className="mt-1 font-mono text-[10px] text-slate-400" title={row.signatureSha256}>Signature ID {shortHash(row.signatureSha256)}</p>
        </div>)}</div>
      </article>;
    })}</div> : null}

    {open ? <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-3 sm:p-6">
      <div className="mx-auto my-3 w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">Vehicle Delivery Signatures</h2>
            <p className="mt-2 text-sm text-slate-600">Invoice {invoiceNumber} · {vehicleLabel} · Final total {totalLabel}</p>
          </div>
          <button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        </div>

        <form action={submit} className="mt-6 space-y-8">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <section className="rounded-xl border border-slate-200 p-4 sm:p-5">
            <h3 className="text-lg font-bold text-slate-950">1. Customer acknowledgement</h3>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{CUSTOMER_DELIVERY_ACKNOWLEDGEMENT_TEXT}</p>
            <label className="mt-4 block text-sm font-semibold text-slate-800">Customer printed name<input name="customerName" defaultValue={defaultCustomerName} required minLength={2} maxLength={120} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
            <div className="mt-4"><SignaturePad label="Customer signature" value={customerSignature} onChange={setCustomerSignature} /></div>
            <label className="mt-4 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" name="customerConsentAccepted" required className="mt-1" /><span>I have reviewed the acknowledgement above and agree that this electronic signature represents my signature.</span></label>
          </section>

          <section className="rounded-xl border border-slate-200 p-4 sm:p-5">
            <h3 className="text-lg font-bold text-slate-950">2. Shop representative acknowledgement</h3>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{SHOP_DELIVERY_ACKNOWLEDGEMENT_TEXT}</p>
            <label className="mt-4 block text-sm font-semibold text-slate-800">Shop representative printed name<input name="shopRepresentativeName" required minLength={2} maxLength={120} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
            <div className="mt-4"><SignaturePad label="Shop representative signature" value={shopSignature} onChange={setShopSignature} /></div>
            <label className="mt-4 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" name="shopConsentAccepted" required className="mt-1" /><span>I confirm the acknowledgement above and agree that this electronic signature represents my signature.</span></label>
          </section>

          {state.status === "error" ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{state.message}</p> : null}
          <div className="sticky bottom-0 -mx-5 flex justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:-mx-7 sm:px-7">
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Recording…" : "Accept & Record Both Signatures"}</button>
          </div>
        </form>
      </div>
    </div> : null}
  </section>;
}
