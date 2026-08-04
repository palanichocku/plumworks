import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { calculateWebTransactionTotals } from "@/lib/invoice-lifecycle";

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
      where: { repairOrderId, shopId, complimentary: false },
      select: { hours: true, hourlyRate: true },
    }),
  ]);

  const totals = calculateWebTransactionTotals({
    parts,
    labor,
    shopSuppliesEnabled: order.shopSuppliesEnabledSnapshot,
    shopSuppliesRate: order.shopSuppliesRateSnapshot,
    shopSuppliesCap: order.shopSuppliesCapSnapshot,
    shopSuppliesTaxable: order.shopSuppliesTaxableSnapshot,
    taxRate: shop.defaultTaxRate,
    partsTaxable: shop.partsTaxable,
    laborTaxable: shop.laborTaxable,
  });

  await transaction.repairOrder.update({
    where: { id: repairOrderId },
    data: {
      partsTotal: totals.partsTotal,
      laborTotal: totals.laborTotal,
      shopSuppliesEligibleLaborTotal: totals.shopSuppliesEligibleLaborTotal,
      shopSuppliesCalculatedAmount: totals.shopSuppliesCalculatedAmount,
      shopSuppliesAmount: totals.shopSuppliesAmount,
      taxTotal: totals.taxTotal,
      estimatedTotal: totals.total,
    },
  });
}
