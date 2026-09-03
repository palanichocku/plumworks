export const INVOICE_VOID_REASON_OPTIONS = [
  { value: "CUSTOMER_DECLINED", label: "Customer declined work" },
  { value: "CUSTOMER_LEFT", label: "Customer left" },
  { value: "DUPLICATE", label: "Duplicate invoice" },
  { value: "CREATED_IN_ERROR", label: "Created in error" },
  { value: "OTHER", label: "Other" },
] as const;

export type InvoiceVoidReason = typeof INVOICE_VOID_REASON_OPTIONS[number]["value"];
export type VoidInvoiceState = { status: "idle" | "success" | "error"; message?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reasons = new Set<string>(INVOICE_VOID_REASON_OPTIONS.map(({ value }) => value));

export function validateInvoiceVoidInput(invoiceId: string, reason: string, note: string) {
  if (reason === "OTHER" && note.length < 3) return "Enter a note explaining the other reason.";
  if (!UUID.test(invoiceId) || !reasons.has(reason) || note.length > 500) return "Select a valid void reason.";
  return null;
}
