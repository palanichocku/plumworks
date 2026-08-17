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
  labor: Array<{ hours: DecimalInput; hourlyRate: DecimalInput }>;
  shopSuppliesEnabled: boolean;
  shopSuppliesRate: DecimalInput;
  shopSuppliesCap: DecimalInput;
  taxRate: DecimalInput;
  partsTaxable: boolean;
  laborTaxable: boolean;
  shopSuppliesTaxable: boolean;
};

function calculateNativeTransactionTotals(input: TransactionTotalsInput) {
  const zero = new Prisma.Decimal(0);
  const partsTotal = input.parts.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const laborTotal = input.labor.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.hours).mul(line.hourlyRate).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const supplies = calculateShopSupplies({ enabled: input.shopSuppliesEnabled, laborSubtotal: laborTotal, rate: input.shopSuppliesRate, maximumCap: input.shopSuppliesCap });
  const shopSuppliesAmount = supplies.appliedAmount;
  const subtotal = partsTotal.plus(laborTotal).toDecimalPlaces(2);
  const taxable = (input.partsTaxable ? partsTotal : zero)
    .plus(input.laborTaxable ? laborTotal : zero)
    .plus(input.shopSuppliesTaxable ? supplies.uncappedAmount : zero);
  const taxTotal = taxable.mul(input.taxRate).toDecimalPlaces(2);
  return { partsTotal, laborTotal, subtotal, shopSuppliesAmount, shopSuppliesEligibleLaborTotal: laborTotal, shopSuppliesCalculatedAmount: shopSuppliesAmount, taxTotal, total: subtotal.plus(shopSuppliesAmount).plus(taxTotal).toDecimalPlaces(2) };
}

export function calculateRepairOrderEstimateTotals(input: TransactionTotalsInput) {
  return calculateNativeTransactionTotals(input);
}

export function calculateWebTransactionTotals(input: TransactionTotalsInput) {
  return calculateNativeTransactionTotals(input);
}

export const calculateEditableInvoiceTotals = calculateWebTransactionTotals;
