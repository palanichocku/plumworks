import { Prisma } from "../generated/prisma/client.ts";
import { invoiceBalance } from "./invoice-lifecycle.ts";
export { paymentMethodLabel, paymentPayerLabel } from "./payment-options.ts";

type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];

export type InvoicePaymentState = "unpaid" | "partially_paid" | "paid";

export function invoicePaymentSummary(totalInput: DecimalInput, paidInput: DecimalInput) {
  const total = new Prisma.Decimal(totalInput).toDecimalPlaces(2);
  const paidTotal = new Prisma.Decimal(paidInput).toDecimalPlaces(2);
  const balance = invoiceBalance(total, paidTotal);
  const status: InvoicePaymentState = balance.isZero() ? "paid" : paidTotal.greaterThan(0) ? "partially_paid" : "unpaid";
  return { total, paidTotal, balance, status };
}

export function paymentStatusLabel(status: InvoicePaymentState) {
  if (status === "partially_paid") return "Partially Paid";
  return status === "paid" ? "Paid" : "Unpaid";
}

export function applyInvoicePayment(totalInput: DecimalInput, existingPaidInput: DecimalInput, amountInput: DecimalInput) {
  const amount = new Prisma.Decimal(amountInput).toDecimalPlaces(2);
  if (!amount.greaterThan(0)) throw new Error("Payment amount must be greater than $0.00.");
  const before = invoicePaymentSummary(totalInput, existingPaidInput);
  if (!before.balance.greaterThan(0)) throw new Error("Invoice has no remaining balance.");
  if (amount.greaterThan(before.balance)) {
    throw new Error(`Payment cannot exceed the remaining balance of $${before.balance.toFixed(2)}.`);
  }
  return invoicePaymentSummary(before.total, before.paidTotal.plus(amount));
}

export function invoiceStateAfterPayment(summary: ReturnType<typeof invoicePaymentSummary>, recordedAt: Date) {
  return summary.balance.isZero()
    ? { status: "closed" as const, closedAt: recordedAt }
    : { status: "open" as const, closedAt: null };
}
