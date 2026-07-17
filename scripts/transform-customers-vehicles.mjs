import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { customerData, vehicleData } from "./lib/customer-vehicle-transform.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");

function report({
  customersInserted,
  customersUpdated,
  vehiclesInserted,
  vehiclesUpdated,
  skippedRows,
  validationErrors,
}) {
  console.log(`customers inserted: ${customersInserted}`);
  console.log(`customers updated: ${customersUpdated}`);
  console.log(`vehicles inserted: ${vehiclesInserted}`);
  console.log(`vehicles updated: ${vehiclesUpdated}`);
  console.log(`skipped records: ${skippedRows}`);
  console.log(`validation issue count: ${validationErrors}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const dryRun = process.argv.includes("--dry-run");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const latestRawCustomer = await prisma.rawLegacyCustomer.findFirst({
      where: { shopId: SHOP_ID },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });

    if (!latestRawCustomer) {
      report({
        customersInserted: 0,
        customersUpdated: 0,
        vehiclesInserted: 0,
        vehiclesUpdated: 0,
        skippedRows: 0,
        validationErrors: 0,
      });
      return;
    }

    const [rawCustomers, rawVehicles] = await Promise.all([
      prisma.rawLegacyCustomer.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latestRawCustomer.legacyImportRunId,
        },
        select: {
          legacyCustno: true,
          rawData: true,
        },
      }),
      prisma.rawLegacyVehicle.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latestRawCustomer.legacyImportRunId,
        },
        select: {
          legacyCustno: true,
          legacyCarno: true,
          rawData: true,
        },
      }),
    ]);

    const customers = rawCustomers.map(customerData).filter(Boolean);
    const vehicles = rawVehicles.map(vehicleData).filter(Boolean);
    const customerLegacyIds = new Set(
      customers.map((customer) => customer.legacyCustno),
    );
    const linkedVehicles = vehicles.filter((vehicle) =>
      customerLegacyIds.has(vehicle.legacyCustno),
    );
    const skippedRows =
      rawCustomers.length -
      customers.length +
      (rawVehicles.length - linkedVehicles.length);
    const [existingCustomers, existingVehicles] = await Promise.all([
      prisma.customer.findMany({
        where: { shopId: SHOP_ID },
        select: { legacyCustno: true },
      }),
      prisma.vehicle.findMany({
        where: { shopId: SHOP_ID },
        select: { legacyCarno: true },
      }),
    ]);
    const existingCustomerIds = new Set(
      existingCustomers
        .map((customer) => customer.legacyCustno)
        .filter(Boolean),
    );
    const existingVehicleIds = new Set(
      existingVehicles.map((vehicle) => vehicle.legacyCarno).filter(Boolean),
    );
    const customersUpdated = customers.filter((customer) =>
      existingCustomerIds.has(customer.legacyCustno),
    ).length;
    const vehiclesUpdated = linkedVehicles.filter((vehicle) =>
      existingVehicleIds.has(vehicle.legacyCarno),
    ).length;
    const customersInserted = customers.length - customersUpdated;
    const vehiclesInserted = linkedVehicles.length - vehiclesUpdated;

    if (dryRun) {
      report({
        customersInserted,
        customersUpdated,
        vehiclesInserted,
        vehiclesUpdated,
        skippedRows,
        validationErrors: skippedRows,
      });
      return;
    }

    const customerIds = new Map();
    for (const customer of customers) {
      const cleanCustomer = await prisma.customer.upsert({
        where: {
          shopId_legacyCustno: {
            shopId: SHOP_ID,
            legacyCustno: customer.legacyCustno,
          },
        },
        update: customer,
        create: {
          shopId: SHOP_ID,
          ...customer,
        },
        select: {
          id: true,
          legacyCustno: true,
        },
      });

      if (cleanCustomer.legacyCustno) {
        customerIds.set(cleanCustomer.legacyCustno, cleanCustomer.id);
      }
    }

    for (const vehicle of linkedVehicles) {
      const customerId = customerIds.get(vehicle.legacyCustno);

      if (!customerId) {
        continue;
      }

      const cleanVehicle = { ...vehicle };
      delete cleanVehicle.legacyCustno;
      await prisma.vehicle.upsert({
        where: {
          shopId_legacyCarno: {
            shopId: SHOP_ID,
            legacyCarno: cleanVehicle.legacyCarno,
          },
        },
        update: {
          customerId,
          ...cleanVehicle,
        },
        create: {
          shopId: SHOP_ID,
          customerId,
          ...cleanVehicle,
        },
      });
    }

    report({
      customersInserted,
      customersUpdated,
      vehiclesInserted,
      vehiclesUpdated,
      skippedRows,
      validationErrors: skippedRows,
    });
  } finally {
    await prisma.$disconnect();
  }
}

await main();
