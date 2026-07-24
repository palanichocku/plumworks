import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { calculateShopSupplies } from "@/lib/shop-supplies";

export async function refreshRepairOrderTotals(
  transaction: Prisma.TransactionClient,
  shopId: string,
  repairOrderId: string,
) {
  const [order, shop, parts, labor] = await Promise.all([
    transaction.repairOrder.findFirstOrThrow({
      where: { id: repairOrderId, shopId, legacySourceTable: null },
      select: { shopSuppliesEnabledSnapshot: true, shopSuppliesRateSnapshot: true, shopSuppliesCapSnapshot: true, shopSuppliesTaxableSnapshot: true },
    }),
    transaction.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { defaultTaxRate: true, partsTaxable: true, laborTaxable: true },
    }),
    transaction.repairOrderPart.findMany({
      where: { repairOrderId, shopId },
      select: { quantity: true, unitPrice: true },
    }),
    transaction.repairOrderLabor.findMany({
      where: { repairOrderId, shopId },
      select: { hours: true, hourlyRate: true },
    }),
  ]);

  const zero = new Prisma.Decimal(0);
  const partsTotal = parts.reduce(
    (sum, line) => sum.plus(line.quantity.mul(line.unitPrice)),
    zero,
  ).toDecimalPlaces(2);
  const laborTotal = labor.reduce(
    (sum, line) => sum.plus(line.hours.mul(line.hourlyRate)),
    zero,
  ).toDecimalPlaces(2);
  const supplies = calculateShopSupplies({
    enabled: order.shopSuppliesEnabledSnapshot,
    laborSubtotal: laborTotal,
    rate: order.shopSuppliesRateSnapshot,
    maximumCap: order.shopSuppliesCapSnapshot,
  });
  const taxableTotal = (shop.partsTaxable ? partsTotal : zero).plus(
    shop.laborTaxable ? laborTotal : zero,
  ).plus(order.shopSuppliesTaxableSnapshot ? supplies.appliedAmount : zero);
  const taxTotal = taxableTotal.mul(shop.defaultTaxRate).toDecimalPlaces(2);

  await transaction.repairOrder.update({
    where: { id: repairOrderId },
    data: {
      partsTotal,
      laborTotal,
      shopSuppliesEligibleLaborTotal: laborTotal,
      shopSuppliesCalculatedAmount: supplies.appliedAmount,
      shopSuppliesAmount: supplies.appliedAmount,
      taxTotal,
      estimatedTotal: partsTotal.plus(laborTotal).plus(supplies.appliedAmount).plus(taxTotal).toDecimalPlaces(2),
    },
  });
}
