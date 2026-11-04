import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { captureQueryPerformanceSample } from "@/lib/system-health/query-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validBearer(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ status: "disabled" }, { status: 404 });
  }
  if (!validBearer(request.headers.get("authorization"), process.env.SYSTEM_HEALTH_COLLECTOR_TOKEN)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await captureQueryPerformanceSample();
    return NextResponse.json({ status: result.captured ? "captured" : "throttled", message: result.message });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
