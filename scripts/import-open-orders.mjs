import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const BATCH_SIZE = 100;
const decoder = new TextDecoder("windows-1252");
function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceFolder = argument("--source");
const sourcePath = (name) => sourceFolder ? resolve(sourceFolder, name) : `OriginalWinApp/Shopman32/data/${name}`;
const SHOP_ID = argument("--shop-id");
if (!SHOP_ID) throw new Error("--shop-id is required.");
const SOURCES = [
  {
    label: "open order part",
    path: sourcePath("orders.DBF"),
    model: "rawLegacyOrderPart",
  },
  {
    label: "open order labor",
    path: sourcePath("LABORorder.DBF"),
    model: "rawLegacyOrderLabor",
  },
];

function parseFields(file, headerLength) {
  const fields = [];
  let recordOffset = 1;
  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) break;
    const descriptor = file.subarray(offset, offset + 32);
    const nameEnd = descriptor.indexOf(0);
    const name = decoder
      .decode(descriptor.subarray(0, nameEnd === -1 ? 11 : nameEnd))
      .trim();
    const type = String.fromCharCode(descriptor[11]);
    const length = descriptor[16];
    fields.push({ name, type, length, recordOffset });
    recordOffset += length;
  }
  return fields;
}

function decodeField(value, type) {
  if (type === "0") return undefined;
  if (["C", "N", "F", "D"].includes(type)) {
    return decoder.decode(value).trim() || null;
  }
  if (type === "L") {
    const logical = decoder.decode(value).trim().toUpperCase();
    if (logical === "T" || logical === "Y") return true;
    if (logical === "F" || logical === "N") return false;
    return null;
  }
  if (type === "I" && value.length === 4) return value.readInt32LE();
  if (type === "B" && value.length === 8) {
    const number = value.readDoubleLE();
    return Number.isFinite(number) ? number : null;
  }
  if (["M", "G", "P"].includes(type)) {
    const pointer = value.length >= 4 ? value.readUInt32LE() : 0;
    return pointer ? { memoPointer: String(pointer) } : null;
  }
  return { hex: value.toString("hex") };
}

function readRows(file) {
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields = parseFields(file, headerLength);
  const rows = [];
  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);
    if (record.length !== recordLength || record[0] === 0x2a) continue;
    const rawData = {};
    for (const field of fields) {
      const bytes = record.subarray(
        field.recordOffset,
        field.recordOffset + field.length,
      );
      const value = decodeField(bytes, field.type);
      if (value !== undefined) rawData[field.name] = value;
    }
    rows.push(rawData);
  }
  return rows;
}

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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function keyedRows(rows, sourceLabel) {
  const occurrences = new Map();
  return rows.map((rawData) => {
    const hash = createHash("sha256")
      .update(JSON.stringify(canonicalize(rawData)))
      .digest("hex")
      .slice(0, 24);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    return {
      rawData,
      legacyRowKey: `${sourceLabel}:${hash}:${occurrence}`,
    };
  });
}

async function loadSources() {
  return Promise.all(
    SOURCES.map(async (source) => ({
      ...source,
      rows: readRows(await readFile(resolve(process.cwd(), source.path))),
    })),
  );
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
      const rows = keyedRows(source.rows, source.model);
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
