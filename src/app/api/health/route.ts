import { NextRequest, NextResponse } from "next/server";
import { authorizedHealthRequest, healthHeaders, healthPayload } from "@/lib/monitoring/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeVersion() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA;
  return revision && /^[a-f0-9]{12,40}$/i.test(revision) ? revision.slice(0, 12) : "local";
}

export async function GET(request: NextRequest) {
  const started = performance.now();
  if (!authorizedHealthRequest(request.headers.get("authorization"), process.env.MONITOR_HEALTH_TOKEN)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401, headers: healthHeaders });
  }

  const databaseStarted = performance.now();
  let databaseOk = false;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    databaseOk = true;
  } catch {
    // Return only fixed operational fields; connection errors can contain secrets.
  }
  return NextResponse.json(
    healthPayload(databaseOk, performance.now() - databaseStarted, performance.now() - started, new Date().toISOString(), safeVersion()),
    { status: databaseOk ? 200 : 503, headers: healthHeaders },
  );
}
