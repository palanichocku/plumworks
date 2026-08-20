import { Prisma } from "../generated/prisma/client.ts";
import { calculateShopSupplies } from "./shop-supplies.ts";
type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];

export const OPEN_INVOICE_STATUS = "open";
export const CLOSED_INVOICE_STATUS = "closed";

export function isEditableOpenInvoice(invoice: { status: string; legacySourceTable: string | null }) {
  return invoice.legacySourceTable === null && invoice.status === OPEN_INVOICE_STATUS;
}

export function invoiceBalance(total: DecimalInput, payments: DecimalInput) {
  return new Prisma.Decimal(total).minus(payments).toDecimalPlaces(2);
}

type TransactionTotalsInput = {
  parts: Array<{ quantity: DecimalInput; unitPrice: DecimalInput }>;
  labor: Array<{ hours: DecimalInput; hourlyRate: DecimalInput; complimentary?: boolean; shopSuppliesEligible?: boolean }>;
  shopSuppliesEnabled: boolean;
  shopSuppliesRate: DecimalInput;
  shopSuppliesCap: DecimalInput;
  taxRate: DecimalInput;
  partsTaxable: boolean;
  laborTaxable: boolean;
  shopSuppliesTaxable: boolean;
  discountAmount?: DecimalInput;
};

function calculateNativeTransactionTotals(input: TransactionTotalsInput) {
  const zero = new Prisma.Decimal(0);
  const partsTotal = input.parts.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const laborTotal = input.labor.reduce((sum, line) => line.complimentary ? sum : sum.plus(new Prisma.Decimal(line.hours).mul(line.hourlyRate).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const shopSuppliesEligibleLaborTotal = input.labor.reduce((sum, line) => line.complimentary || line.shopSuppliesEligible === false ? sum : sum.plus(new Prisma.Decimal(line.hours).mul(line.hourlyRate).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const supplies = calculateShopSupplies({ enabled: input.shopSuppliesEnabled, laborSubtotal: shopSuppliesEligibleLaborTotal, rate: input.shopSuppliesRate, maximumCap: input.shopSuppliesCap });
  const shopSuppliesAmount = supplies.appliedAmount;
  const subtotal = partsTotal.plus(laborTotal).toDecimalPlaces(2);
  const discountAmount = new Prisma.Decimal(input.discountAmount ?? 0).toDecimalPlaces(2);
  if (discountAmount.lessThan(0)) throw new Error("Discount cannot be negative.");
  if (discountAmount.greaterThan(subtotal)) throw new Error("Discount cannot exceed Parts and Labor.");
  const partsDiscount = subtotal.isZero() ? zero : discountAmount.mul(partsTotal).div(subtotal).toDecimalPlaces(2);
  const laborDiscount = discountAmount.minus(partsDiscount).toDecimalPlaces(2);
  const discountedParts = partsTotal.minus(partsDiscount).toDecimalPlaces(2);
  const discountedLabor = laborTotal.minus(laborDiscount).toDecimalPlaces(2);
  const taxable = (input.partsTaxable ? discountedParts : zero)
    .plus(input.laborTaxable ? discountedLabor : zero)
    .plus(input.shopSuppliesTaxable ? supplies.uncappedAmount : zero);
  const taxTotal = taxable.mul(input.taxRate).toDecimalPlaces(2);
  return { partsTotal, laborTotal, subtotal, discountAmount, partsDiscount, laborDiscount, discountedParts, discountedLabor, shopSuppliesAmount, shopSuppliesEligibleLaborTotal, shopSuppliesCalculatedAmount: shopSuppliesAmount, taxTotal, total: subtotal.plus(shopSuppliesAmount).minus(discountAmount).plus(taxTotal).toDecimalPlaces(2) };
}

export function calculateRepairOrderEstimateTotals(input: Omit<TransactionTotalsInput, "discountAmount">) {
  return calculateNativeTransactionTotals({ ...input, discountAmount: 0 });
}

export function calculateWebTransactionTotals(input: TransactionTotalsInput) {
  return calculateNativeTransactionTotals(input);
}

export const calculateEditableInvoiceTotals = calculateWebTransactionTotals;
