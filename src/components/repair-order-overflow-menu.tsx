"use client";

import { useEffect, useRef, useState } from "react";
import { VoidRepairOrderButton } from "@/components/void-repair-order-button";

export function RepairOrderOverflowMenu({ repairOrderId, repairOrderNumber }: {
  repairOrderId: string;
  repairOrderNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return <div ref={menuRef} className="relative">
    <button
      type="button"
      aria-label="More Repair Order actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className="flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-bold leading-none text-slate-700 hover:border-brand-primary hover:text-brand-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20"
    >
      •••
    </button>
    {open ? <div role="menu" className="absolute right-0 z-20 mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <VoidRepairOrderButton repairOrderId={repairOrderId} repairOrderNumber={repairOrderNumber} compact />
    </div> : null}
  </div>;
}
