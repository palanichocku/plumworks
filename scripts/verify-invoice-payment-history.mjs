import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const webInvoicesWithPayments = await prisma.invoice.count({
    where: {
      legacySourceTable: null,
      repairOrderNumber: { not: null },
      payments: { some: {} },
    },
  });
  const paymentRowsDisplayed = await prisma.payment.count({
    where: {
      invoice: {
        is: {
          legacySourceTable: null,
          repairOrderNumber: { not: null },
        },
      },
    },
  });
  const importedLegacyInvoicesUnchanged = await prisma.invoice.count({
    where: { legacySourceTable: { not: null } },
  });

  console.log(`web invoices with payments: ${webInvoicesWithPayments}`);
  console.log(`payment rows displayed: ${paymentRowsDisplayed}`);
  console.log(`imported legacy invoices unchanged: ${importedLegacyInvoicesUnchanged}`);
} finally {
  await prisma.$disconnect();
}
