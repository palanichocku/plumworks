export const PAYMENT_PAYER_TYPES = ["CUSTOMER", "INSURANCE", "WARRANTY", "OTHER"] as const;
export type PaymentPayerTypeValue = (typeof PAYMENT_PAYER_TYPES)[number];

export const PAYMENT_METHODS = ["cash", "card", "debit_card", "check", "ach_eft", "other"] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_PAYER_LABELS: Record<PaymentPayerTypeValue, string> = {
  CUSTOMER: "Customer",
  INSURANCE: "Insurance",
  WARRANTY: "Warranty Company",
  OTHER: "Other",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  cash: "Cash",
  card: "Credit Card",
  debit_card: "Debit Card",
  check: "Check",
  ach_eft: "ACH/EFT",
  other: "Other",
};

export function paymentPayerLabel(value: string | null | undefined) {
  return PAYMENT_PAYER_LABELS[value as PaymentPayerTypeValue] ?? "Other";
}

export function paymentMethodLabel(value: string | null | undefined) {
  return PAYMENT_METHOD_LABELS[value as PaymentMethodValue] ?? (value?.trim() || "Not specified");
}
