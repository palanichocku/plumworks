import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const now = new Date();
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

try {
  const shop = await prisma.shop.findFirst({ select: { id: true } });
  if (!shop) throw new Error("Shop is unavailable.");
  const invoiceWhere = { shopId: shop.id, invoiceDate: { gte: start, lt: endExclusive } };
  const paymentWhere = { shopId: shop.id, paidAt: { gte: start, lt: endExclusive } };
  const arWhere = { shopId: shop.id, status: "open", balance: { gt: 0 }, invoiceId: { not: null } };
  const [invoices, payments, receivables, invoiceTotals, paymentTotals, arTotals, importedBefore] = await Promise.all([
    prisma.invoice.findMany({ where: invoiceWhere, select: { total: true, partsTotal: true, laborTotal: true, taxTotal: true } }),
    prisma.payment.findMany({ where: paymentWhere, select: { amount: true } }),
    prisma.accountReceivable.findMany({ where: arWhere, select: { balance: true } }),
    prisma.invoice.aggregate({ where: invoiceWhere, _sum: { total: true, partsTotal: true, laborTotal: true, taxTotal: true } }),
    prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true } }),
    prisma.accountReceivable.aggregate({ where: arWhere, _sum: { balance: true } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  const sum = (values) => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
  const invoiceMatches = sum(invoices.map((row) => row.total)).equals(invoiceTotals._sum.total ?? 0)
    && sum(invoices.map((row) => row.partsTotal)).equals(invoiceTotals._sum.partsTotal ?? 0)
    && sum(invoices.map((row) => row.laborTotal)).equals(invoiceTotals._sum.laborTotal ?? 0)
    && sum(invoices.map((row) => row.taxTotal)).equals(invoiceTotals._sum.taxTotal ?? 0);
  const paymentMatches = sum(payments.map((row) => row.amount)).equals(paymentTotals._sum.amount ?? 0);
  const arMatches = sum(receivables.map((row) => row.balance)).equals(arTotals._sum.balance ?? 0);
  const importedAfter = await prisma.invoice.count({ where: { legacySourceTable: { not: null } } });

  console.log(`invoices counted: ${invoices.length}`);
  console.log(`payments counted: ${payments.length}`);
  console.log(`AR rows counted: ${receivables.length}`);
  console.log(`totals match source rows: ${Number(invoiceMatches && paymentMatches && arMatches)}`);
  console.log(`imported records unchanged: ${Number(importedBefore === importedAfter)}`);
} finally {
  await prisma.$disconnect();
}
