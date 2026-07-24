import { Prisma } from "../generated/prisma/browser.ts";

type DecimalInput = ConstructorParameters<typeof Prisma.Decimal>[0];
type DecimalValue = InstanceType<typeof Prisma.Decimal>;

export type ShopSuppliesCalculation = {
  laborSubtotal: DecimalValue;
  configuredRate: DecimalValue;
  uncappedAmount: DecimalValue;
  configuredCap: DecimalValue;
  appliedAmount: DecimalValue;
  capApplied: boolean;
};

export function calculateShopSupplies(input: {
  enabled: boolean;
  laborSubtotal: DecimalInput;
  rate: DecimalInput;
  maximumCap: DecimalInput;
}): ShopSuppliesCalculation {
  const laborSubtotal = new Prisma.Decimal(input.laborSubtotal);
  const configuredRate = new Prisma.Decimal(input.rate);
  const configuredCap = new Prisma.Decimal(input.maximumCap);

  if (!laborSubtotal.isFinite() || laborSubtotal.isNegative()) {
    throw new Error("Labor subtotal must be zero or greater.");
  }
  if (!configuredRate.isFinite() || configuredRate.isNegative() || configuredRate.greaterThan(1)) {
    throw new Error("Shop Supplies rate must be between 0 and 100 percent.");
  }
  if (!configuredCap.isFinite() || configuredCap.isNegative()) {
    throw new Error("Shop Supplies maximum charge must be zero or greater.");
  }

  const rawUncappedAmount = laborSubtotal.mul(configuredRate);
  const capApplied = input.enabled && rawUncappedAmount.greaterThan(0) && rawUncappedAmount.greaterThanOrEqualTo(configuredCap);
  const appliedAmount = input.enabled
    ? Prisma.Decimal.min(rawUncappedAmount, configuredCap).toDecimalPlaces(2)
    : new Prisma.Decimal(0);

  return {
    laborSubtotal: laborSubtotal.toDecimalPlaces(2),
    configuredRate,
    uncappedAmount: rawUncappedAmount.toDecimalPlaces(2),
    configuredCap: configuredCap.toDecimalPlaces(2),
    appliedAmount,
    capApplied,
  };
}

export function calculateShopSuppliesFromPercentage(input: {
  enabled: boolean;
  laborSubtotal: DecimalInput;
  ratePercent: DecimalInput;
  maximumCap: DecimalInput;
}) {
  const ratePercent = new Prisma.Decimal(input.ratePercent);
  if (!ratePercent.isFinite() || ratePercent.isNegative() || ratePercent.greaterThan(100)) {
    throw new Error("Shop Supplies rate must be between 0 and 100 percent.");
  }
  return calculateShopSupplies({ ...input, rate: ratePercent.div(100) });
}
