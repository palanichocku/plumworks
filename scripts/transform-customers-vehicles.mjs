import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CAR_DOC_SHOP_ID = "00000000-0000-4000-8000-000000000001";

function rawValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }

  const value = rawData[field];
  return value === null || value === undefined ? null : String(value).trim();
}

function cleanText(value) {
  return value?.replaceAll(/\s+/g, " ").trim() || null;
}

function cleanEmail(value) {
  const email = cleanText(value)?.toLowerCase();
  return email && email.includes("@") ? email : null;
}

function cleanPhone(value) {
  return cleanText(value);
}

function cleanInteger(value, minimum = 0, maximum = 2147483647) {
  if (!value) {
    return null;
  }

  const number = Number.parseInt(value.replaceAll(/[^0-9-]/g, ""), 10);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function customerData(row) {
  const legacyCustno = cleanText(row.legacyCustno);
  const displayName = cleanText(rawValue(row.rawData, "CUSTOMER"));

  if (!legacyCustno || !displayName) {
    return null;
  }

  return {
    legacyCustno,
    displayName,
    phone: cleanPhone(rawValue(row.rawData, "PHONE")),
    phone2: cleanPhone(rawValue(row.rawData, "PHONE2")),
    email: cleanEmail(rawValue(row.rawData, "EMAIL")),
    addressLine1: cleanText(rawValue(row.rawData, "ADDRESS")),
    addressLine2: cleanText(rawValue(row.rawData, "ADDRESS2")),
    city: cleanText(rawValue(row.rawData, "CITY")),
    state: cleanText(rawValue(row.rawData, "STATE"))?.toUpperCase() ?? null,
    postalCode: cleanText(rawValue(row.rawData, "ZIP")),
    notes: cleanText(rawValue(row.rawData, "NOTE")),
    message: cleanText(rawValue(row.rawData, "MESSAGE")),
    legacySourceTable: "Cust.DBF",
  };
}

function vehicleData(row) {
  const legacyCustno = cleanText(row.legacyCustno);
  const legacyCarno = cleanText(row.legacyCarno);

  if (!legacyCustno || !legacyCarno) {
    return null;
  }

  return {
    legacyCustno,
    legacyCarno,
    year: cleanInteger(rawValue(row.rawData, "YEAR"), 1886, 2200),
    make: cleanText(rawValue(row.rawData, "MAKE")),
    model: cleanText(rawValue(row.rawData, "MODEL")),
    engine: cleanText(rawValue(row.rawData, "MOTOR")),
    vin: cleanText(rawValue(row.rawData, "VIN"))?.toUpperCase() ?? null,
    licensePlate:
      cleanText(rawValue(row.rawData, "LICENSE"))?.toUpperCase() ?? null,
    odometer: cleanInteger(rawValue(row.rawData, "ODOMETER")),
    notes:
      cleanText(rawValue(row.rawData, "NOTE")) ??
      cleanText(rawValue(row.rawData, "HISTNOTES")),
    message: cleanText(rawValue(row.rawData, "MESSAGE")),
    legacySourceTable: "vehicles.DBF",
  };
}

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
      where: { shopId: CAR_DOC_SHOP_ID },
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
          shopId: CAR_DOC_SHOP_ID,
          legacyImportRunId: latestRawCustomer.legacyImportRunId,
        },
        select: {
          legacyCustno: true,
          rawData: true,
        },
      }),
      prisma.rawLegacyVehicle.findMany({
        where: {
          shopId: CAR_DOC_SHOP_ID,
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
        where: { shopId: CAR_DOC_SHOP_ID },
        select: { legacyCustno: true },
      }),
      prisma.vehicle.findMany({
        where: { shopId: CAR_DOC_SHOP_ID },
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
            shopId: CAR_DOC_SHOP_ID,
            legacyCustno: customer.legacyCustno,
          },
        },
        update: customer,
        create: {
          shopId: CAR_DOC_SHOP_ID,
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
            shopId: CAR_DOC_SHOP_ID,
            legacyCarno: cleanVehicle.legacyCarno,
          },
        },
        update: {
          customerId,
          ...cleanVehicle,
        },
        create: {
          shopId: CAR_DOC_SHOP_ID,
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
