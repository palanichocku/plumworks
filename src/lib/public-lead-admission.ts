import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { leadProtectionHash } from "@/lib/public-lead-verification";
import { normalizeLeadText, type PublicLeadData } from "@/lib/public-lead-validation";

export function publicLeadFingerprint(shopId: string, data: PublicLeadData) {
  return leadProtectionHash(JSON.stringify([
    "submission-v1", shopId, data.source, data.email.toLowerCase(), data.phone,
    data.requestedService, data.vehicleYear,
    normalizeLeadText(data.vehicleMake ?? "").toLowerCase(),
    normalizeLeadText(data.vehicleModel ?? "").toLowerCase(),
    data.preferredDate?.toISOString().slice(0, 10) ?? null, data.preferredTime,
  ]));
}

export function publicLeadAdmission(shopId: string, data: PublicLeadData, ip: string) {
  const fingerprint = publicLeadFingerprint(shopId, data);
  const ipHash = leadProtectionHash(`ip:${shopId}:${ip}`);
  const emailHash = leadProtectionHash(`email:${shopId}:${data.email}`);
  const phoneHash = leadProtectionHash(`phone:${shopId}:${data.phone}`);
  return async (transaction: Prisma.TransactionClient) => {
    // Transaction-scoped locks work with Supabase transaction pooling. One lock
    // per shop serializes the short admission + insert transaction across instances.
    await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`public-lead:${shopId}`}, 0))`;
    // Prisma's timestamp columns use UTC without a zone. Return that same type
    // explicitly; raw timestamptz decoding can drop a non-UTC session's offset.
    const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    const cutoff = new Date(now.getTime() - 30 * 60 * 1000);
    const table = transaction.publicLeadSubmission;
    // Bound cleanup work even after a long idle period. The (shop_id, created_at)
    // index locates the oldest expired rows; the shop lock also serializes cleanup.
    const expired = await table.findMany({
      where: { shopId, createdAt: { lte: cutoff } },
      orderBy: { createdAt: "asc" }, take: 100, select: { id: true },
    });
    if (expired.length) await table.deleteMany({ where: { shopId, id: { in: expired.map(({ id }) => id) } } });
    if (await table.findFirst({ where: { shopId, fingerprint, createdAt: { gt: cutoff } }, select: { id: true } })) return false;
    const ipCount = await table.count({ where: { shopId, ipHash, createdAt: { gt: new Date(now.getTime() - 10 * 60 * 1000) } } });
    const emailCount = await table.count({ where: { shopId, emailHash, createdAt: { gt: cutoff } } });
    const phoneCount = await table.count({ where: { shopId, phoneHash, createdAt: { gt: cutoff } } });
    if (ipCount >= 5 || emailCount >= 3 || phoneCount >= 3) throw new Error("Submission unavailable");
    await table.create({ data: { shopId, fingerprint, ipHash, emailHash, phoneHash, createdAt: now } });
    return true;
  };
}
