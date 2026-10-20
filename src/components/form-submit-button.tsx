"use client";

import { useCallback, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";

const REPAIR_ORDER_NEEDS_SAVE_EVENT = "plumworks:repair-order-needs-save";

function markRepairOrderNeedsSave(form: HTMLFormElement | null) {
  if (!form) return;
  const field = form.elements.namedItem("repairOrderId");
  if (!(field instanceof HTMLInputElement) || !field.value) return;
  window.dispatchEvent(new CustomEvent(REPAIR_ORDER_NEEDS_SAVE_EVENT, {
    detail: { repairOrderId: field.value },
  }));
}

export function FormSubmitButton({ children, pendingLabel = "Saving…", pendingAriaLabel, confirmMessage, confirmTitle, confirmDescription, confirmLabel, cancelLabel, destructive = false, className, disabled = false, formAction, form, title, ariaLabel }: { children: React.ReactNode; pendingLabel?: React.ReactNode; pendingAriaLabel?: string; confirmMessage?: string; confirmTitle?: string; confirmDescription?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; className: string; disabled?: boolean; formAction?: (formData: FormData) => void | Promise<void>; form?: string; title?: string; ariaLabel?: string }) {
  const { pending } = useFormStatus(); const buttonRef = useRef<HTMLButtonElement>(null); const [open, setOpen] = useState(false);
  const close = useCallback(() => { if (!pending) setOpen(false); }, [pending]);
  const needsConfirmation = Boolean(confirmMessage || confirmTitle || confirmDescription);
  const legacyTitle = confirmMessage?.match(/^.*?\?/)?.[0] ?? confirmMessage;
  const legacyDescription = confirmMessage?.slice(legacyTitle?.length ?? 0).trim();
  const inferredDestructive = destructive || /delete|remove|revoke/i.test(confirmTitle ?? confirmMessage ?? "");
  const confirm = () => { const button = buttonRef.current; const targetForm = button?.form; if (!button || !targetForm) return; setOpen(false); markRepairOrderNeedsSave(targetForm); targetForm.requestSubmit(button); };
  return <><button ref={buttonRef} type="submit" form={form} formAction={formAction} disabled={disabled || pending} title={title} aria-label={pending ? pendingAriaLabel ?? ariaLabel : ariaLabel} onClick={(event) => { const targetForm = event.currentTarget.form; if (needsConfirmation) { event.preventDefault(); if (targetForm && !targetForm.reportValidity()) return; setOpen(true); return; } if (targetForm && targetForm.reportValidity()) markRepairOrderNeedsSave(targetForm); }} className={className}>{pending ? pendingLabel : children}</button>{needsConfirmation && <ConfirmDialog open={open} title={confirmTitle ?? legacyTitle ?? "Confirm action"} description={confirmDescription ?? legacyDescription ?? (inferredDestructive ? "This cannot be undone." : "Are you sure you want to continue?")} confirmLabel={confirmLabel} cancelLabel={cancelLabel} destructive={inferredDestructive} pending={pending} onConfirm={confirm} onCancel={close} />}</>;
}
