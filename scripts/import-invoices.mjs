import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const SOURCES = [
  {
    label: "FINAL",
    path: "OriginalWinApp/Shopman32/data/FINAL.DBF",
    model: "rawLegacyFinal",
  },
  {
    label: "Labor final",
    path: "OriginalWinApp/Shopman32/data/laborfinal.DBF",
    memoPath: "OriginalWinApp/Shopman32/data/laborfinal.FPT",
    model: "rawLegacyLaborFinal",
  },
  {
    label: "AR",
    path: "OriginalWinApp/Shopman32/data/ar.DBF",
    model: "rawLegacyAr",
  },
];
const BATCH_SIZE = 100;
const decoder = new TextDecoder("windows-1252");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseFields(header, headerLength) {
  const fields = [];
  let recordOffset = 1;

  for (let offset = 32; offset + 32 <= headerLength; offset += 32) {
    if (header[offset] === 0x0d) break;

    const descriptor = header.subarray(offset, offset + 32);
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

function decodeMemo(value, memoFile) {
  if (!memoFile || value.length < 4) return null;
  const pointer = value.readUInt32LE();
  if (!pointer) return null;

  const blockSize = memoFile.readUInt16BE(6);
  const offset = pointer * blockSize;
  if (!blockSize || offset + 8 > memoFile.length) return null;

  const blockType = memoFile.readUInt32BE(offset);
  const length = memoFile.readUInt32BE(offset + 4);
  if (blockType !== 1 || length > memoFile.length - offset - 8) return null;

  return decoder.decode(memoFile.subarray(offset + 8, offset + 8 + length))
    .replaceAll("\0", "")
    .trim() || null;
}

function decodeField(value, type, memoFile) {
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
    if (memoFile) return decodeMemo(value, memoFile);
    return {
      memoPointer:
        value.length >= 4
          ? String(value.readUInt32LE())
          : decoder.decode(value).trim(),
    };
  }
  return { hex: value.toString("hex") };
}

function decodeRecord(record, fields, memoFile) {
  const rawData = {};
  for (const field of fields) {
    const value = record.subarray(
      field.recordOffset,
      field.recordOffset + field.length,
    );
    const decoded = decodeField(value, field.type, memoFile);
    if (decoded !== undefined) rawData[field.name] = decoded;
  }
  return rawData;
}

async function readSample(relativePath, limit = 5, memoRelativePath) {
  const file = await open(resolve(process.cwd(), relativePath), "r");
  try {
    const memoFile = memoRelativePath
      ? await readFile(resolve(process.cwd(), memoRelativePath))
      : null;
    const start = Buffer.alloc(32);
    const firstRead = await file.read(start, 0, 32, 0);
    if (firstRead.bytesRead !== 32) throw new Error("Invalid DBF header.");

    const recordCount = start.readUInt32LE(4);
    const headerLength = start.readUInt16LE(8);
    const recordLength = start.readUInt16LE(10);
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
      if (result.bytesRead !== recordLength) break;
      if (record[0] !== 0x2a) {
        records.push(decodeRecord(record, fields, memoFile));
      }
    }

    return { recordCount, fields, records };
  } finally {
    await file.close();
  }
}

async function readAll(relativePath, memoRelativePath) {
  const file = await readFile(resolve(process.cwd(), relativePath));
  const memoFile = memoRelativePath
    ? await readFile(resolve(process.cwd(), memoRelativePath))
    : null;
  const recordCount = file.readUInt32LE(4);
  const headerLength = file.readUInt16LE(8);
  const recordLength = file.readUInt16LE(10);
  const fields = parseFields(file, headerLength);
  const records = [];

  for (let index = 0; index < recordCount; index += 1) {
    const start = headerLength + index * recordLength;
    const record = file.subarray(start, start + recordLength);
    if (record.length === recordLength && record[0] !== 0x2a) {
      records.push(decodeRecord(record, fields, memoFile));
    }
  }
  return records;
}

function legacyValue(record, candidates) {
  const entry = Object.entries(record).find(([key]) =>
    candidates.includes(key.toUpperCase().replaceAll("_", "")),
  );
  return entry?.[1] == null ? null : String(entry[1]).trim();
}

async function runDryRun() {
  for (const source of SOURCES) {
    try {
      const sample = await readSample(source.path, 5, source.memoPath);
      const fieldNames = sample.fields
        .filter((field) => field.type !== "0")
        .map((field) => field.name);
      const hasRoNumber = fieldNames.some((name) =>
        ["RONO", "RO", "RONUMBER", "INVOICE", "INVNO"].includes(
          name.toUpperCase().replaceAll("_", ""),
        ),
      );
      const validationIssues = hasRoNumber ? 0 : 1;

      console.log(`${source.label} file: found`);
      console.log(`${source.label} row count estimate: ${sample.recordCount}`);
      console.log(`${source.label} field names: ${fieldNames.join(", ")}`);
      console.log(`${source.label} sample rows read: ${sample.records.length}`);
      console.log(
        `${source.label} validation issue count: ${validationIssues}`,
      );
    } catch {
      console.log(`${source.label} file: not found`);
      console.log(`${source.label} row count estimate: unavailable`);
      console.log(`${source.label} field names: unavailable`);
      console.log(`${source.label} sample rows read: 0`);
      console.log(`${source.label} validation issue count: 1`);
    }
  }
}

async function runImport() {
  const shopId = argument("--shop-id");
  const databaseUrl = process.env.DATABASE_URL;
  if (!shopId || !/^[0-9a-f-]{36}$/i.test(shopId)) {
    throw new Error("Provide a valid shop UUID with --shop-id.");
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  let importRun;

  try {
    importRun = await prisma.legacyImportRun.create({
      data: {
        shopId,
        status: "running",
        sourceLabel: "Invoice, labor, and AR DBF staging",
        startedAt: new Date(),
      },
    });
    let imported = 0;
    const counts = {};

    for (const source of SOURCES) {
      const rows = await readAll(source.path, source.memoPath);
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        await prisma[source.model].createMany({
          data: batch.map((rawData) => ({
            shopId,
            legacyImportRunId: importRun.id,
            legacyRoNo: legacyValue(rawData, [
              "RONO",
              "RO",
              "RONUMBER",
              "INVOICE",
              "INVNO",
            ]),
            legacyCustno: legacyValue(rawData, ["CUSTNO", "CUSTOMERNO"]),
            legacyCarno: legacyValue(rawData, ["CARNO", "VEHICLENO"]),
            rawData,
          })),
        });
      }
      imported += rows.length;
      counts[source.model] = rows.length;
    }

    await prisma.legacyImportRun.update({
      where: { id: importRun.id },
      data: {
        status: "staged",
        completedAt: new Date(),
        recordsProcessed: imported,
        recordsImported: imported,
      },
    });
    console.log(`FINAL rows inserted: ${counts.rawLegacyFinal ?? 0}`);
    console.log(
      `laborfinal rows inserted: ${counts.rawLegacyLaborFinal ?? 0}`,
    );
    console.log(`AR rows inserted: ${counts.rawLegacyAr ?? 0}`);
    console.log(`import run id: ${importRun.id}`);
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

if (process.argv.includes("--dry-run")) {
  await runDryRun();
} else {
  await runImport();
}
