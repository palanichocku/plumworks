import { timingSafeEqual } from "node:crypto";

export const healthHeaders = { "Cache-Control": "no-store" };

export function authorizedHealthRequest(header: string | null, configuredToken: string | undefined): boolean {
  if (!configuredToken || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(configuredToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function healthPayload(databaseOk: boolean, databaseMs: number, totalMs: number, timestamp: string, version: string) {
  return {
    status: databaseOk ? "ok" : "failed",
    database: databaseOk ? "ok" : "failed",
    databaseMs: Math.round(databaseMs),
    totalMs: Math.round(totalMs),
    timestamp,
    version,
  };
}
