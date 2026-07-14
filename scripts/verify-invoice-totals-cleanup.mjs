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

function close(left, right) {
  return Math.abs(left - right) < 0.01;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const latest = await prisma.rawLegacyAr.findFirst({
      where: { shopId: SHOP_ID },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });
    if (!latest) throw new Error("No staged AR import run was found.");

    const [rawRows, invoices] = await Promise.all([
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
          partsTotal: true,
          laborTotal: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          paidTotal: true,
          accountsReceivable: { take: 1, select: { balance: true } },
        },
      }),
    ]);

    const arByRo = new Map();
    for (const row of rawRows) {
      const ro = row.legacyRoNo?.trim();
      if (ro && !arByRo.has(ro)) arByRo.set(ro, row.rawData);
    }

    let zeroWithPositiveAr = 0;
    let subtotalMatches = 0;
    let taxMatches = 0;
    let totalMatches = 0;
    let paidMatches = 0;
    let balanceMatches = 0;

    for (const invoice of invoices) {
      const ar = invoice.legacyRoNo ? arByRo.get(invoice.legacyRoNo) : null;
      if (!ar) continue;
      const parts = numberValue(ar, "PARTS") ?? 0;
      const labor = numberValue(ar, "LABOR") ?? 0;
      const tax = TAX_FIELDS.reduce(
        (sum, field) => sum + (numberValue(ar, field) ?? 0),
        0,
      );
      const total = numberValue(ar, "TOTAL") ?? parts + labor + tax;
      const paid = numberValue(ar, "PAYMENT") ?? 0;
      const balance = numberValue(ar, "BALANCE") ?? total - paid;

      if (close(Number(invoice.total.toString()), 0) && total > 0.009) {
        zeroWithPositiveAr += 1;
      }
      if (
        close(Number(invoice.partsTotal.toString()), parts) &&
        close(Number(invoice.laborTotal.toString()), labor) &&
        close(Number(invoice.subtotal.toString()), parts + labor)
      ) {
        subtotalMatches += 1;
      }
      if (close(Number(invoice.taxTotal.toString()), tax)) taxMatches += 1;
      if (close(Number(invoice.total.toString()), total)) totalMatches += 1;
      if (close(Number(invoice.paidTotal.toString()), paid)) paidMatches += 1;
      const cleanBalance = invoice.accountsReceivable[0]?.balance;
      if (cleanBalance && close(Number(cleanBalance.toString()), balance)) {
        balanceMatches += 1;
      }
    }

    console.log(`total invoices: ${invoices.length}`);
    console.log(`invoices total zero with positive AR total: ${zeroWithPositiveAr}`);
    console.log(`invoices subtotal matches AR parts plus labor: ${subtotalMatches}`);
    console.log(`invoices tax matches combined AR tax: ${taxMatches}`);
    console.log(`invoices total matches AR total: ${totalMatches}`);
    console.log(`invoices paid matches AR payment: ${paidMatches}`);
    console.log(`invoices balance matches AR/fallback balance: ${balanceMatches}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
