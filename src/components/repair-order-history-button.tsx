"use client";

import { useCallback, useRef, useState } from "react";
import { RepairOrderHistoryDrawer } from "@/components/repair-order-history-drawer";

export function RepairOrderHistoryButton({ customerId, currentRepairOrderId, className }: { customerId: string; currentRepairOrderId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  return <>
    <button ref={buttonRef} type="button" onClick={() => setOpen(true)} className={className ?? "rounded-lg border border-brand-primary/30 px-4 py-2.5 text-sm font-semibold text-brand-primary hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/20"}>History</button>
    {open ? <RepairOrderHistoryDrawer customerId={customerId} currentRepairOrderId={currentRepairOrderId} onClose={close} /> : null}
  </>;
}
