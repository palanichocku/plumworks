import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

const SOURCES = ["LABOR_DONE", "NOTE", "JOBDESC", "CODE"];

function textValue(rawData, field) {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return null;
  }
  const value = rawData[field];
  return typeof value === "string" ? value.trim() || null : null;
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

function laborHash(rawData) {
  const identity =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? Object.fromEntries(
          Object.entries(rawData).filter(([field]) => field !== "NOTE"),
        )
      : rawData;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(identity)))
    .digest("hex")
    .slice(0, 24);
}

function sourceFor(rawData) {
  return SOURCES.find((field) => textValue(rawData, field)) ?? "Legacy labor";
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const shopId = await resolveSingleShopId(prisma);
    const latest = await prisma.rawLegacyLaborFinal.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: { legacyImportRunId: true },
    });
    if (!latest) throw new Error("No staged labor import run was found.");

    const [rawRows, cleanRows] = await Promise.all([
      prisma.rawLegacyLaborFinal.findMany({
        where: {
          shopId,
          legacyImportRunId: latest.legacyImportRunId,
        },
        select: { legacyRoNo: true, rawData: true },
      }),
      prisma.invoiceLabor.findMany({
        where: { shopId },
        select: { legacyLineKey: true, description: true },
      }),
    ]);

    const cleanKeys = new Set(cleanRows.map((row) => row.legacyLineKey));
    const occurrences = new Map();
    const counts = Object.fromEntries(
      [...SOURCES, "Legacy labor"].map((source) => [source, 0]),
    );

    for (const row of rawRows) {
      const ro = row.legacyRoNo?.trim();
      if (!ro) continue;
      const hash = laborHash(row.rawData);
      const occurrenceKey = `${ro}:${hash}`;
      const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const lineKey = `laborfinal:${ro}:${hash}:${occurrence}`;
      if (cleanKeys.has(lineKey)) counts[sourceFor(row.rawData)] += 1;
    }

    const objectLike = cleanRows.filter(
      (row) => row.description.trim() === "[object Object]",
    ).length;
    const legacyFallback = cleanRows.filter(
      (row) => row.description.trim() === "Legacy labor",
    ).length;

    console.log(`clean invoice_labor total rows: ${cleanRows.length}`);
    console.log(`rows using LABOR_DONE-derived description: ${counts.LABOR_DONE}`);
    console.log(`rows using NOTE-derived description: ${counts.NOTE}`);
    console.log(`rows using JOBDESC-derived description: ${counts.JOBDESC}`);
    console.log(`rows using CODE-derived description: ${counts.CODE}`);
    console.log(`rows still using Legacy labor: ${legacyFallback}`);
    console.log(`rows with [object Object]: ${objectLike}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
