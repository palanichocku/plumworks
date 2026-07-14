import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const TAX_FIELDS = ["TAX", "TAX2", "TAX3", "TAX4", "TAX5", "TAX6"];

function numberValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }
  const value = rawData[field];
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).replaceAll(/[^0-9.-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function firstByRo(rows) {
  const result = new Map();
  for (const row of rows) {
    const ro = row.legacyRoNo?.trim();
    if (ro && !result.has(ro)) result.set(ro, row.rawData);
  }
  return result;
}

function sumByRo(rows, amount) {
  const result = new Map();
  for (const row of rows) {
    const ro = row.legacyRoNo?.trim();
    if (!ro) continue;
    result.set(ro, (result.get(ro) ?? 0) + amount(row.rawData));
  }
  return result;
}

function close(left, right) {
  return Math.abs(left - right) < 0.01;
}

function fieldNames(rows) {
  const names = new Set();
  for (const row of rows) {
    if (row.rawData && typeof row.rawData === "object" && !Array.isArray(row.rawData)) {
      for (const field of Object.keys(row.rawData)) names.add(field);
    }
  }
  return [...names].sort();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const latest = await prisma.rawLegacyFinal.findFirst({
      where: { shopId: SHOP_ID },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });
    if (!latest) throw new Error("No staged invoice import run was found.");

    const [rawFinal, rawLabor, rawAr, invoices] = await Promise.all([
      prisma.rawLegacyFinal.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { legacyRoNo: true, rawData: true },
      }),
      prisma.rawLegacyLaborFinal.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { legacyRoNo: true, rawData: true },
      }),
      prisma.rawLegacyAr.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { legacyRoNo: true, rawData: true },
      }),
      prisma.invoice.findMany({
        where: { shopId: SHOP_ID },
        select: {
          legacyRoNo: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          parts: { select: { quantity: true, unitPrice: true } },
          labor: { select: { hours: true, hourlyRate: true } },
          accountsReceivable: { take: 1, select: { balance: true } },
        },
      }),
    ]);

    const finalHeaders = firstByRo(rawFinal);
    const arHeaders = firstByRo(rawAr);
    const rawPartTotals = sumByRo(rawFinal, (rawData) =>
      (numberValue(rawData, "QTY") ?? 1) * (numberValue(rawData, "PRICE") ?? 0),
    );
    const rawLaborTotals = sumByRo(
      rawLabor,
      (rawData) => numberValue(rawData, "LABOR") ?? 0,
    );

    let zeroHeaderWithLines = 0;
    let arTotalAvailable = 0;
    let arTotalDiffersFromCleanLines = 0;
    let taxPositiveTotalZero = 0;
    let cleanArAvailable = 0;
    let arComponentsReconcile = 0;
    let arTotalMatchesRawLineAmounts = 0;
    let finalTotalAvailable = 0;
    let paidAvailable = 0;
    let balanceAvailable = 0;
    let partsTotalAvailable = 0;
    let laborTotalAvailable = 0;
    let paymentAvailable = 0;
    let paidBooleanTrue = 0;
    let paidBooleanFalse = 0;
    let calculatedBalancePositive = 0;
    let calculatedBalanceZero = 0;
    let paymentMatchesTenderSum = 0;
    let cleanBalanceMatchesCalculated = 0;

    for (const invoice of invoices) {
      const ro = invoice.legacyRoNo?.trim();
      const cleanParts = invoice.parts.reduce(
        (sum, part) =>
          sum + Number(part.quantity.toString()) * Number(part.unitPrice.toString()),
        0,
      );
      const cleanLabor = invoice.labor.reduce(
        (sum, labor) =>
          sum + Number(labor.hours.toString()) * Number(labor.hourlyRate.toString()),
        0,
      );
      const cleanLines = cleanParts + cleanLabor;
      const cleanTotal = Number(invoice.total.toString());
      const cleanTax = Number(invoice.taxTotal.toString());
      if (close(cleanTotal, 0) && cleanLines > 0.009) zeroHeaderWithLines += 1;
      if (cleanTax > 0.009 && close(cleanTotal, 0)) taxPositiveTotalZero += 1;
      if (invoice.accountsReceivable.length) cleanArAvailable += 1;
      if (!ro) continue;

      const final = finalHeaders.get(ro);
      if (numberValue(final, "TOTAL") != null) finalTotalAvailable += 1;
      const ar = arHeaders.get(ro);
      const arTotal = numberValue(ar, "TOTAL");
      if (arTotal != null) {
        arTotalAvailable += 1;
        if (!close(arTotal, cleanLines)) arTotalDiffersFromCleanLines += 1;
      }
      const arParts = numberValue(ar, "PARTS");
      const arLabor = numberValue(ar, "LABOR");
      const arTaxes = TAX_FIELDS.reduce(
        (sum, field) => sum + (numberValue(ar, field) ?? 0),
        0,
      );
      if (arTotal != null && arParts != null && arLabor != null) {
        if (close(arParts + arLabor + arTaxes, arTotal)) arComponentsReconcile += 1;
      }
      if (arTotal != null) {
        const rawLines =
          (rawPartTotals.get(ro) ?? 0) + (rawLaborTotals.get(ro) ?? 0) + arTaxes;
        if (close(rawLines, arTotal)) arTotalMatchesRawLineAmounts += 1;
      }
      if (
        ["PAID", "AMTPAID", "PAYMENT"].some(
          (field) => numberValue(ar, field) != null,
        )
      ) {
        paidAvailable += 1;
      }
      if (numberValue(ar, "BALANCE") != null) balanceAvailable += 1;
      if (arParts != null) partsTotalAvailable += 1;
      if (arLabor != null) laborTotalAvailable += 1;
      const payment = numberValue(ar, "PAYMENT");
      if (payment != null) {
        paymentAvailable += 1;
        const calculatedBalance = (arTotal ?? 0) - payment;
        if (calculatedBalance > 0.009) calculatedBalancePositive += 1;
        else if (close(calculatedBalance, 0)) calculatedBalanceZero += 1;
        const tenderSum = [
          "CASH",
          "CHECK",
          "AMEX",
          "DISCOVER",
          "MAST_VISA",
          "ACCOUNT",
        ].reduce((sum, field) => sum + (numberValue(ar, field) ?? 0), 0);
        if (close(payment, tenderSum)) paymentMatchesTenderSum += 1;
        const cleanBalance = invoice.accountsReceivable[0]?.balance;
        if (
          cleanBalance &&
          close(Number(cleanBalance.toString()), calculatedBalance)
        ) {
          cleanBalanceMatchesCalculated += 1;
        }
      }
      if (ar && typeof ar === "object" && !Array.isArray(ar)) {
        if (ar.PAID === true) paidBooleanTrue += 1;
        if (ar.PAID === false) paidBooleanFalse += 1;
      }
    }

    console.log(`raw FINAL field names: ${fieldNames(rawFinal).join(", ")}`);
    console.log(`raw laborfinal field names: ${fieldNames(rawLabor).join(", ")}`);
    console.log(`raw AR field names: ${fieldNames(rawAr).join(", ")}`);
    console.log(`total invoices: ${invoices.length}`);
    console.log(
      `invoices total zero with positive calculated lines: ${zeroHeaderWithLines}`,
    );
    console.log(`invoices with raw AR total available: ${arTotalAvailable}`);
    console.log(`invoices with clean AR row available: ${cleanArAvailable}`);
    console.log(
      `invoices where raw AR total differs from calculated clean lines: ${arTotalDiffersFromCleanLines}`,
    );
    console.log(`invoices tax positive and total zero: ${taxPositiveTotalZero}`);
    console.log(`invoices with raw FINAL total available: ${finalTotalAvailable}`);
    console.log(`invoices with raw paid field available: ${paidAvailable}`);
    console.log(`invoices with raw balance available: ${balanceAvailable}`);
    console.log(`invoices with raw parts total available: ${partsTotalAvailable}`);
    console.log(`invoices with raw labor total available: ${laborTotalAvailable}`);
    console.log(`invoices with numeric PAYMENT available: ${paymentAvailable}`);
    console.log(`raw PAID boolean true count: ${paidBooleanTrue}`);
    console.log(`raw PAID boolean false count: ${paidBooleanFalse}`);
    console.log(`calculated TOTAL minus PAYMENT positive: ${calculatedBalancePositive}`);
    console.log(`calculated TOTAL minus PAYMENT zero: ${calculatedBalanceZero}`);
    console.log(`PAYMENT matches tender field sum: ${paymentMatchesTenderSum}`);
    console.log(
      `clean AR balance matches TOTAL minus PAYMENT: ${cleanBalanceMatchesCalculated}`,
    );
    console.log(`raw AR component totals reconcile: ${arComponentsReconcile}`);
    console.log(
      `raw AR total matches raw calculated line amounts: ${arTotalMatchesRawLineAmounts}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
