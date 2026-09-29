export const REPAIR_ORDER_VOID_REASON_OPTIONS = [
  { value: "CREATED_IN_ERROR", label: "Entered in error" },
  { value: "DUPLICATE", label: "Duplicate RO" },
  { value: "WRONG_ASSIGNMENT", label: "Wrong customer/vehicle" },
  { value: "OTHER", label: "Other" },
] as const;

export type RepairOrderVoidReason = typeof REPAIR_ORDER_VOID_REASON_OPTIONS[number]["value"];
export type VoidRepairOrderState = { status: "idle" | "success" | "error"; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reasons = new Map<string, string>(REPAIR_ORDER_VOID_REASON_OPTIONS.map(({ value, label }) => [value, label]));

export function validateRepairOrderVoidInput(repairOrderId: string, reason: string, note: string) {
  const normalizedNote = note.trim();
  if (!UUID.test(repairOrderId)) return "This Repair Order could not be identified.";
  if (!reasons.has(reason)) return "Select a valid void reason.";
  if (normalizedNote.length > 500) return "The explanation must be 500 characters or fewer.";
  if (reason === "OTHER" && normalizedNote.length < 3) return "Please explain the reason in at least 3 characters.";
  return null;
}

export function repairOrderVoidReasonLabel(reason: string | null | undefined) {
  return reason ? reasons.get(reason) ?? "Unspecified" : "Unspecified";
}

export function repairOrderVoidEligibilityError(order: {
  status: string;
  repairOrderNumber: number | null;
  legacySourceTable: string | null;
  hasInvoice: boolean;
} | null) {
  if (!order) return "Repair Order was not found for this Shop.";
  if (order.legacySourceTable !== null) return "Historical imported Repair Orders cannot be voided.";
  if (order.status === "void") return "This Repair Order has already been voided.";
  if (order.repairOrderNumber === null) return "Only numbered Repair Orders can be voided.";
  if (order.status !== "draft" && order.status !== "open") return "Only Draft or Open Repair Orders without an Invoice can be voided.";
  if (order.hasInvoice) return "A Repair Order with an Invoice cannot be voided.";
  return null;
}
