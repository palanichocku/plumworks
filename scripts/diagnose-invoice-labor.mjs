import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const DESCRIPTION_FIELDS = ["NOTE", "JOBDESC", "CODE"];

function isNonEmpty(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function valueType(value) {
  if (value == null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;
  if ("memoPointer" in value) return "memo-object";
  if ("hex" in value) return "hex-object";
  if (value.type === "Buffer" && Array.isArray(value.data)) return "buffer-like";
  return "object";
}

function mappedValue(rawData) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }
  for (const field of DESCRIPTION_FIELDS) {
    if (isNonEmpty(rawData[field])) return rawData[field];
  }
  return null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const latest = await prisma.rawLegacyLaborFinal.findFirst({
      where: { shopId: SHOP_ID },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });

    if (!latest) {
      console.log("raw laborfinal field names: unavailable");
      for (const field of DESCRIPTION_FIELDS) {
        console.log(`${field} non-empty count: 0`);
      }
      console.log("mapped labor description value types: null=0");
      console.log("total raw labor rows: 0");
      console.log("decoded NOTE non-empty count: 0");
      console.log("clean invoice_labor total rows: 0");
      console.log("clean invoice_labor rows with [object Object]: 0");
      console.log("clean invoice_labor blank/unavailable count: 0");
      console.log("clean blank description count: 0");
      console.log("clean unavailable description count: 0");
      console.log("clean object-like description count: 0");
      return;
    }

    const [rawRows, cleanRows] = await Promise.all([
      prisma.rawLegacyLaborFinal.findMany({
        where: {
          shopId: SHOP_ID,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { rawData: true },
      }),
      prisma.invoiceLabor.findMany({
        where: { shopId: SHOP_ID },
        select: { description: true },
      }),
    ]);

    const fieldNames = new Set();
    const nonEmptyCounts = Object.fromEntries(
      DESCRIPTION_FIELDS.map((field) => [field, 0]),
    );
    const typeCounts = new Map();

    for (const row of rawRows) {
      const rawData = row.rawData;
      if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
        for (const field of Object.keys(rawData)) fieldNames.add(field);
        for (const field of DESCRIPTION_FIELDS) {
          if (isNonEmpty(rawData[field])) nonEmptyCounts[field] += 1;
        }
      }
      const type = valueType(mappedValue(rawData));
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    let blank = 0;
    let unavailable = 0;
    let objectLike = 0;
    for (const row of cleanRows) {
      const description = row.description.trim();
      if (!description) blank += 1;
      if (
        description === "Labor description unavailable" ||
        description === "Legacy labor"
      ) {
        unavailable += 1;
      }
      if (
        description === "[object Object]" ||
        description.startsWith("{") ||
        description.startsWith("[")
      ) {
        objectLike += 1;
      }
    }

    console.log(
      `raw laborfinal field names: ${[...fieldNames].sort().join(", ")}`,
    );
    for (const field of DESCRIPTION_FIELDS) {
      console.log(`${field} non-empty count: ${nonEmptyCounts[field]}`);
    }
    console.log(
      `mapped labor description value types: ${[...typeCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, count]) => `${type}=${count}`)
        .join(", ")}`,
    );
    console.log(`total raw labor rows: ${rawRows.length}`);
    console.log(`decoded NOTE non-empty count: ${nonEmptyCounts.NOTE}`);
    console.log(`clean invoice_labor total rows: ${cleanRows.length}`);
    console.log(`clean invoice_labor rows with [object Object]: ${objectLike}`);
    console.log(
      `clean invoice_labor blank/unavailable count: ${blank + unavailable}`,
    );
    console.log(`clean blank description count: ${blank}`);
    console.log(`clean unavailable description count: ${unavailable}`);
    console.log(`clean object-like description count: ${objectLike}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
