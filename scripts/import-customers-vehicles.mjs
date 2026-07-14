import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CUSTOMER_DBF = "OriginalWinApp/Shopman32/data/Cust.DBF";
const VEHICLE_DBF = "OriginalWinApp/Shopman32/data/vehicles.DBF";
const BATCH_SIZE = 100;
const decoder = new TextDecoder("windows-1252");

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseFields(file, headerLength) {
  const fields = [];
  let recordOffset = 1;

  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (file[offset] === 0x0d) {
      break;
    }

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

function decodeCurrency(value) {
  const amount = value.readBigInt64LE();
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 10000n;
  const fraction = String(absolute % 10000n).padStart(4, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function decodeField(value, type) {
  if (type === "0") {
    return undefined;
  }

  if (["C", "N", "F", "D"].includes(type)) {
    return decoder.decode(value).trim() || null;
  }

  if (type === "L") {
    const logical = decoder.decode(value).trim().toUpperCase();
    return logical === "T" || logical === "Y"
      ? true
      : logical === "F" || logical === "N"
        ? false
        : null;
  }

  if (type === "I" && value.length === 4) {
    return value.readInt32LE();
  }

  if (type === "Y" && value.length === 8) {
    return decodeCurrency(value);
  }

  if (type === "B" && value.length === 8) {
    const number = value.readDoubleLE();
    return Number.isFinite(number) ? number : null;
  }

  if (["M", "G", "P"].includes(type)) {
    return {
      memoPointer:
        value.length >= 4
          ? String(value.readUInt32LE())
          : decoder.decode(value).trim(),
    };
  }

  return { hex: value.toString("hex") };
}

function decodeRecord(record, fields) {
  const rawData = {};

  for (const field of fields) {
    const value = record.subarray(
      field.recordOffset,
      field.recordOffset + field.length,
    );
    const decoded = decodeField(value, field.type);
    if (decoded !== undefined) {
      rawData[field.name] = decoded;
    }
  }

  return rawData;
}

async function readDbf(relativePath) {
  const file = await readFile(resolve(process.cwd(), relativePath));
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields = parseFields(file, headerLength);
  const records = [];

  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);

    if (record.length !== recordLength || record[0] === 0x2a) {
      continue;
    }

    records.push(decodeRecord(record, fields));
  }

  return records;
}

async function readDbfSample(relativePath, limit = 5) {
  const file = await open(resolve(process.cwd(), relativePath), "r");

  try {
    const headerStart = Buffer.alloc(32);
    const { bytesRead } = await file.read(headerStart, 0, 32, 0);
    if (bytesRead !== 32) {
      throw new Error("Invalid DBF header.");
    }

    const recordCount = headerStart.readUInt32LE(4);
    const headerLength = headerStart.readUInt16LE(8);
    const recordLength = headerStart.readUInt16LE(10);
    const header = Buffer.alloc(headerLength);
    await file.read(header, 0, headerLength, 0);
    const fields = parseFields(header, headerLength);
    const records = [];

    for (let index = 0; index < recordCount && records.length < limit; index += 1) {
      const record = Buffer.alloc(recordLength);
      const result = await file.read(
        record,
        0,
        recordLength,
        headerLength + index * recordLength,
      );

      if (result.bytesRead !== recordLength) {
        break;
      }

      if (record[0] !== 0x2a) {
        records.push(decodeRecord(record, fields));
      }
    }

    return { recordCount, fields, records };
  } finally {
    await file.close();
  }
}

function legacyValue(record, candidates) {
  const entry = Object.entries(record).find(([key]) =>
    candidates.includes(key.toUpperCase().replaceAll("_", "")),
  );
  const value = entry?.[1];
  return value === null || value === undefined ? null : String(value).trim();
}

async function insertBatches(records, createData) {
  for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
    const batch = records.slice(offset, offset + BATCH_SIZE);
    await createData(batch);
  }
}

async function reportDryRunFile(label, relativePath, requiredFields) {
  try {
    const sample = await readDbfSample(relativePath);
    const fieldNames = sample.fields
      .filter((field) => field.type !== "0")
      .map((field) => field.name);
    const normalizedNames = new Set(
      fieldNames.map((name) => name.toUpperCase().replaceAll("_", "")),
    );
    let validationIssues = requiredFields.some((candidate) =>
      normalizedNames.has(candidate),
    )
      ? 0
      : 1;

    validationIssues += sample.records.filter(
      (record) => !legacyValue(record, requiredFields),
    ).length;

    console.log(`${label} file: found`);
    console.log(`${label} row count estimate: ${sample.recordCount}`);
    console.log(`${label} field names: ${fieldNames.join(", ")}`);
    console.log(`${label} sample rows read: ${sample.records.length}`);
    console.log(`${label} validation issues count: ${validationIssues}`);
  } catch {
    console.log(`${label} file: not found`);
    console.log(`${label} row count estimate: unavailable`);
    console.log(`${label} field names: unavailable`);
    console.log(`${label} sample rows read: 0`);
    console.log(`${label} validation issues count: 1`);
  }
}

async function runDryRun() {
  await reportDryRunFile("Customer", CUSTOMER_DBF, [
    "CUSTNO",
    "CUSTOMERNO",
  ]);
  await reportDryRunFile("Vehicle", VEHICLE_DBF, ["CARNO", "VEHICLENO"]);
}

async function runImport() {
  const shopId = getArgument("--shop-id");
  const databaseUrl = process.env.DATABASE_URL;

  if (!shopId || !/^[0-9a-f-]{36}$/i.test(shopId)) {
    throw new Error("Provide a valid shop UUID with --shop-id.");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  let importRun;

  try {
    importRun = await prisma.legacyImportRun.create({
      data: {
        shopId,
        status: "running",
        sourceLabel: "Customer and vehicle DBF staging",
        startedAt: new Date(),
      },
    });

    const customerRows = await readDbf(CUSTOMER_DBF);
    const vehicleRows = await readDbf(VEHICLE_DBF);

    await insertBatches(customerRows, (batch) =>
      prisma.rawLegacyCustomer.createMany({
        data: batch.map((rawData) => ({
          shopId,
          legacyImportRunId: importRun.id,
          legacyCustno: legacyValue(rawData, ["CUSTNO", "CUSTOMERNO"]),
          rawData,
        })),
      }),
    );

    await insertBatches(vehicleRows, (batch) =>
      prisma.rawLegacyVehicle.createMany({
        data: batch.map((rawData) => ({
          shopId,
          legacyImportRunId: importRun.id,
          legacyCustno: legacyValue(rawData, ["CUSTNO", "CUSTOMERNO"]),
          legacyCarno: legacyValue(rawData, ["CARNO", "VEHICLENO"]),
          rawData,
        })),
      }),
    );

    await prisma.legacyImportRun.update({
      where: { id: importRun.id },
      data: {
        status: "staged",
        completedAt: new Date(),
        recordsProcessed: customerRows.length + vehicleRows.length,
        recordsImported: customerRows.length + vehicleRows.length,
      },
    });

    console.log("Customer and vehicle staging complete.");
  } catch {
    if (importRun) {
      await prisma.legacyImportRun.update({
        where: { id: importRun.id },
        data: {
          status: "failed",
          completedAt: new Date(),
        },
      });
    }

    console.error("Customer and vehicle staging failed.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv.includes("--dry-run")) {
  await runDryRun();
} else {
  await runImport();
}
