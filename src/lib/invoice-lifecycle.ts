import { Prisma } from "../generated/prisma/client.ts";
type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];

export function isEditableOpenInvoice(invoice: { status: string; legacySourceTable: string | null }) {
  return invoice.legacySourceTable === null && invoice.status === "open";
}

export function invoiceBalance(total: DecimalInput, payments: DecimalInput) {
  return new Prisma.Decimal(total).minus(payments).toDecimalPlaces(2);
}

export function calculateEditableInvoiceTotals(input: {
  parts: Array<{ quantity: DecimalInput; unitPrice: DecimalInput }>;
  labor: Array<{ hours: DecimalInput; hourlyRate: DecimalInput }>;
  shopSuppliesAmount: DecimalInput;
  taxRate: DecimalInput;
  partsTaxable: boolean;
  laborTaxable: boolean;
  shopSuppliesTaxable: boolean;
}) {
  const zero = new Prisma.Decimal(0);
  const partsTotal = input.parts.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.quantity).mul(line.unitPrice).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const laborTotal = input.labor.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.hours).mul(line.hourlyRate).toDecimalPlaces(2)), zero).toDecimalPlaces(2);
  const shopSuppliesAmount = new Prisma.Decimal(input.shopSuppliesAmount).toDecimalPlaces(2);
  const subtotal = partsTotal.plus(laborTotal).toDecimalPlaces(2);
  const taxable = (input.partsTaxable ? partsTotal : zero)
    .plus(input.laborTaxable ? laborTotal : zero)
    .plus(input.shopSuppliesTaxable ? shopSuppliesAmount : zero);
  const taxTotal = taxable.mul(input.taxRate).toDecimalPlaces(2);
  return { partsTotal, laborTotal, subtotal, taxTotal, total: subtotal.plus(shopSuppliesAmount).plus(taxTotal).toDecimalPlaces(2) };
}
