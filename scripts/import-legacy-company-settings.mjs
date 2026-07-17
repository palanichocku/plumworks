import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  const [shop, importedInvoicesBefore] = await Promise.all([
    prisma.shop.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
  ]);
  if (!shop) throw new Error("Shop settings row was not found.");

  const result = await prisma.shop.updateMany({
    where: { id: shop.id },
    data: {
      defaultTaxRate: "0.06",
      partsTaxable: true,
      laborTaxable: false,
      defaultLaborRate: "60.00",
      invoiceFooterMessage: "THE CAR DOC THANKS YOU FOR YOUR BUSINESS",
      warrantyText:
        "LABOR IS GUARANTEED FOR 90 DAYS OR 3000 MILES\nPART WARRANTIES ARE EXPRESSED BY MANUFACTURER",
    },
  });

  const [settingsRows, settings, importedInvoicesAfter] = await Promise.all([
    prisma.shop.count({
      where: {
        id: shop.id,
        defaultTaxRate: "0.06",
        partsTaxable: true,
        laborTaxable: false,
        defaultLaborRate: "60.00",
        invoiceFooterMessage: { not: null },
        warrantyText: { not: null },
      },
    }),
    prisma.shop.findFirst({
      where: { id: shop.id },
      select: {
        defaultTaxRate: true,
        partsTaxable: true,
        laborTaxable: true,
        invoiceFooterMessage: true,
        warrantyText: true,
      },
    }),
    prisma.invoice.count({ where: { legacySourceTable: { not: null } } }),
  ]);

  if (!settings) throw new Error("Shop settings row was not found.");
  const sampleParts = new Prisma.Decimal(100);
  const sampleLabor = new Prisma.Decimal(100);
  const taxableSample = (settings.partsTaxable ? sampleParts : new Prisma.Decimal(0))
    .plus(settings.laborTaxable ? sampleLabor : new Prisma.Decimal(0));
  const sampleTaxValid = taxableSample.mul(settings.defaultTaxRate).equals(6);
  const printSettingsPopulated = Boolean(
    settings.invoiceFooterMessage && settings.warrantyText,
  );

  console.log(`shop settings rows updated: ${result.count}`);
  console.log(`shop settings rows verified: ${settingsRows}`);
  console.log(
    `imported invoices unchanged: ${Number(importedInvoicesBefore === importedInvoicesAfter)}`,
  );
  console.log(`new repair-order tax calculation valid: ${Number(sampleTaxValid)}`);
  console.log(`print settings rows populated: ${Number(printSettingsPopulated)}`);
} finally {
  await prisma.$disconnect();
}
