import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { printLegacySourceSummary, resolveLegacySource } from "./lib/legacy-source.mjs";
import { loadOpenOrderSourceRows } from "./lib/legacy-open-order-source.mjs";

const BATCH_SIZE = 100;
function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const source = await resolveLegacySource({ requiredFiles: ["orders.DBF", "LABORorder.DBF"] });
printLegacySourceSummary(source);
const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");
const SOURCES = [
  {
    label: "open order part",
    path: source.files["orders.DBF"],
    model: "rawLegacyOrderPart",
  },
  {
    label: "open order labor",
    path: source.files["LABORorder.DBF"],
    model: "rawLegacyOrderLabor",
  },
];

function legacyValue(record, candidates) {
  const entry = Object.entries(record).find(([field]) =>
    candidates.includes(field.toUpperCase().replaceAll("_", "")),
  );
  return entry?.[1] == null ? null : String(entry[1]).trim() || null;
}

function identifiers(rawData) {
  return {
    ro: legacyValue(rawData, ["RONO", "RO", "RONUMBER", "INVNUM"]),
    custno: legacyValue(rawData, ["CUSTNO", "CUSTOMERNO"]),
    carno: legacyValue(rawData, ["CARNO", "VEHICLENO"]),
  };
}

async function loadSources() {
  const rows = await loadOpenOrderSourceRows(source);
  return SOURCES.map((entry) => ({
    ...entry,
    rows: entry.model === "rawLegacyOrderPart" ? rows.partRows : rows.laborRows,
  }));
}

async function runDryRun() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const sources = await loadSources();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const [customers, vehicles] = await Promise.all([
      prisma.customer.findMany({
        where: { shopId: SHOP_ID, legacyCustno: { not: null } },
        select: { legacyCustno: true },
      }),
      prisma.vehicle.findMany({
        where: { shopId: SHOP_ID, legacyCarno: { not: null } },
        select: { legacyCarno: true },
      }),
    ]);
    const customerIds = new Set(customers.map((row) => row.legacyCustno));
    const vehicleIds = new Set(vehicles.map((row) => row.legacyCarno));
    const allRows = sources.flatMap((source) => source.rows);
    const ids = allRows.map(identifiers);
    const roNumbers = new Set(ids.map((row) => row.ro).filter(Boolean));
    const linkedCustomers = new Set(
      ids.map((row) => row.custno).filter((id) => id && customerIds.has(id)),
    );
    const linkedVehicles = new Set(
      ids.map((row) => row.carno).filter((id) => id && vehicleIds.has(id)),
    );
    const validationIssues = ids.filter(
      (row) =>
        !row.ro ||
        (row.custno && !customerIds.has(row.custno)) ||
        (row.carno && !vehicleIds.has(row.carno)),
    ).length;

    console.log(`open order part rows found: ${sources[0].rows.length}`);
    console.log(`open order labor rows found: ${sources[1].rows.length}`);
    console.log(`distinct RO numbers: ${roNumbers.size}`);
    console.log(`linkable customers by CUSTNO: ${linkedCustomers.size}`);
    console.log(`linkable vehicles by CARNO: ${linkedVehicles.size}`);
    console.log(`validation issues count: ${validationIssues}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function runImport() {
  const shopId = argument("--shop-id");
  const databaseUrl = process.env.DATABASE_URL;
  if (!shopId || !/^[0-9a-f-]{36}$/i.test(shopId)) {
    throw new Error("Provide a valid shop UUID with --shop-id.");
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const sources = await loadSources();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  let importRun;

  try {
    importRun = await prisma.legacyImportRun.create({
      data: {
        shopId,
        status: "running",
        sourceLabel: "Open repair order parts and labor staging",
        startedAt: new Date(),
      },
    });
    for (const source of sources) {
      const rows = source.rows;
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        await prisma.$transaction(
          batch.map(({ rawData, legacyRowKey }) => {
            const ids = identifiers(rawData);
            const data = {
              legacyImportRunId: importRun.id,
              legacyRoNo: ids.ro,
              legacyCustno: ids.custno,
              legacyCarno: ids.carno,
              rawData,
            };
            return prisma[source.model].upsert({
              where: {
                shopId_legacyRowKey: { shopId, legacyRowKey },
              },
              create: { shopId, legacyRowKey, ...data },
              update: data,
            });
          }),
        );
      }
    }
    const total = sources.reduce((sum, source) => sum + source.rows.length, 0);
    await prisma.legacyImportRun.update({
      where: { id: importRun.id },
      data: {
        status: "staged",
        completedAt: new Date(),
        recordsProcessed: total,
        recordsImported: total,
      },
    });
    console.log(`open order part rows staged: ${sources[0].rows.length}`);
    console.log(`open order labor rows staged: ${sources[1].rows.length}`);
    console.log("status: pass");
  } catch {
    if (importRun) {
      await prisma.legacyImportRun.update({
        where: { id: importRun.id },
        data: { status: "failed", completedAt: new Date() },
      });
    }
    console.log("status: fail");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes("--dry-run")) await runDryRun();
else await runImport();
