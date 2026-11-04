import "server-only";
import { prisma } from "@/lib/prisma";

// Platform telemetry only; no customer-facing request should call the collector.
// The SQL identifies probable application SQL, not guaranteed origin identity.
export type RecentQuery = {
  sql: string;
  operation: string;
  classification: "application" | "maintenance";
  calls: number;
  meanMs: number;
  totalMs: number;
};
export type QueryPerformanceWindow = {
  status: "collecting" | "ready" | "unavailable" | "reset" | "stale";
  from: Date | null;
  to: Date | null;
  queries: RecentQuery[];
  detail: string;
  latestAt: Date | null;
  sampleCount: number;
  maximumGapMinutes: number | null;
  observedHours: number;
};

type Snapshot = { id: string; captured_at: Date; stats_reset_at: Date };
type Sample = {
  db_id: bigint; user_id: bigint; query_id: string;
  operation: string; classification: string; query_text: string | null;
  calls: bigint; total_exec_ms: number;
};

export async function captureQueryPerformanceSample() {
  // DEV-only until the production migration and scheduler receive separate approval.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV) {
    throw new Error("Query snapshot collection is not enabled for Production.");
  }
  // Limit snapshots to one per 5 minutes, preventing accidental load from repeated clicks.
  const recent = await prisma.$queryRaw<{ captured_at: Date }[]>`
    SELECT captured_at FROM system_health_query_snapshots
    ORDER BY captured_at DESC LIMIT 1
  `;
  if (recent[0] && Date.now() - new Date(recent[0].captured_at).getTime() < 300_000) {
    return { captured: false, message: "Sample already captured in the last five minutes." };
  }

  // The whole capture is transactional: no half-written snapshot can be compared.
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO system_health_query_snapshots (stats_reset_at)
      SELECT stats_reset FROM pg_stat_statements_info
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error("Query statistics extension is not available.");
    await tx.$executeRaw`
      INSERT INTO system_health_query_samples
        (snapshot_id, db_id, user_id, query_id, operation, classification, calls, total_exec_ms)
      SELECT
        ${id}::uuid, dbid::bigint, userid::bigint, queryid::text,
        CASE
          WHEN upper(ltrim(query)) LIKE 'DELETE%' THEN 'DELETE'
          WHEN upper(ltrim(query)) LIKE 'UPDATE%' THEN 'UPDATE'
          WHEN upper(ltrim(query)) LIKE 'INSERT%' THEN 'INSERT'
          ELSE 'SELECT'
        END,
        CASE
          WHEN query ~* '(raw_legacy_|legacy_import_|_prisma_migrations|pg_catalog|information_schema|pg_stat_|cutover|import_runs)'
            OR query ~* '^\\s*DELETE\\s+FROM\\s+("?public"?\\.)?"?(vehicles|customers|invoices)"?\\s+WHERE\\s+.*shop_id'
          THEN 'maintenance' ELSE 'application'
        END,
        calls, total_exec_time::float8
      FROM pg_stat_statements
      WHERE queryid IS NOT NULL
        AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query ~* '(customers|vehicles|repair_orders|repair_order_parts|repair_order_labor|invoices|invoice_parts|invoice_labor|payments|accounts_receivable|marketing_leads|marketing_services|shops|shop_memberships|audit_logs)'
        AND upper(ltrim(query)) ~ '^(SELECT|DELETE|UPDATE|INSERT)'
      ORDER BY total_exec_time DESC
      LIMIT 500
    `;
    // Retain 30 days; cascading samples are deleted automatically.
    await tx.$executeRaw`
      DELETE FROM system_health_query_snapshots
      WHERE captured_at < now() - interval '30 days'
    `;
  }, { timeout: 15_000 });
  return { captured: true, message: "Query statistics snapshot captured." };
}

export async function getRecentQueryPerformance(): Promise<QueryPerformanceWindow> {
  const empty = { latestAt: null, sampleCount: 0, maximumGapMinutes: null, observedHours: 0 };
  try {
    const history = await prisma.$queryRaw<{ captured_at: Date }[]>`
      SELECT captured_at FROM system_health_query_snapshots
      WHERE captured_at >= now() - interval '24 hours'
      ORDER BY captured_at ASC LIMIT 144
    `;
    const stampTimes = history.map((row) => new Date(row.captured_at).getTime());
    const maxGapMinutes = stampTimes.length >= 2
      ? Math.max(...stampTimes.slice(1).map((stamp, i) => (stamp - stampTimes[i]) / 60_000))
      : null;
    const observedHours = stampTimes.length >= 2
      ? (stampTimes[stampTimes.length - 1] - stampTimes[0]) / 3_600_000
      : 0;
    const metrics = {
      latestAt: history.length ? history[history.length - 1].captured_at : null,
      sampleCount: history.length,
      maximumGapMinutes: maxGapMinutes,
      observedHours,
    };

    const current = await prisma.$queryRaw<Snapshot[]>`
      SELECT id, captured_at, stats_reset_at
      FROM system_health_query_snapshots
      WHERE captured_at >= now() - interval '24 hours'
      ORDER BY captured_at DESC LIMIT 1
    `;
    const latest = current[0];
    if (!latest) return {
      status: "collecting", from: null, to: null, queries: [],
      detail: "No valid baseline yet. Capture the first sample to begin.",
      ...metrics,
    };
    const before = await prisma.$queryRaw<Snapshot[]>`
      SELECT id, captured_at, stats_reset_at
      FROM system_health_query_snapshots
      WHERE captured_at >= now() - interval '24 hours' AND captured_at < ${latest.captured_at}
      ORDER BY captured_at ASC LIMIT 1
    `;
    const baseline = before[0];
    if (!baseline) return {
      status: "collecting", from: latest.captured_at, to: null, queries: [],
      detail: "Baseline captured. A second sample is needed to measure new executions.",
      ...metrics,
    };
    if (new Date(latest.stats_reset_at).getTime() !== new Date(baseline.stats_reset_at).getTime()) {
      return {
        status: "reset", from: baseline.captured_at, to: latest.captured_at, queries: [],
        detail: "PostgreSQL query statistics were reset during this window. Capture a fresh baseline.",
        ...metrics,
      };
    }
    if (Date.now() - new Date(latest.captured_at).getTime() > 150 * 60_000) {
      return {
        status: "stale", from: baseline.captured_at, to: latest.captured_at, queries: [],
        detail: "Collection is stale: no sample in the last 2½ hours. Verify the hourly scheduler. Historical values are not current alerts.",
        ...metrics,
      };
    }
    const rows = await prisma.$queryRaw<(Sample & { previous_calls: bigint | null; previous_total_ms: number | null })[]>`
      SELECT n.db_id, n.user_id, n.query_id, n.operation, n.classification,
             left(stats.query, 4000) AS query_text, n.calls, n.total_exec_ms,
             p.calls AS previous_calls, p.total_exec_ms AS previous_total_ms
      FROM system_health_query_samples n
      LEFT JOIN pg_stat_statements stats
        ON stats.dbid::bigint = n.db_id
       AND stats.userid::bigint = n.user_id
       AND stats.queryid::text = n.query_id
      LEFT JOIN system_health_query_samples p
        ON p.snapshot_id = ${baseline.id}::uuid
       AND p.db_id = n.db_id AND p.user_id = n.user_id AND p.query_id = n.query_id
      WHERE n.snapshot_id = ${latest.id}::uuid
    `;
    const queries: RecentQuery[] = rows.flatMap((row) => {
      // A query not in the baseline may predate it; don't invent its past execution count.
      if (row.previous_calls === null || row.previous_total_ms === null) return [];
      const calls = Number(row.calls - row.previous_calls);
      const totalMs = Number(row.total_exec_ms) - Number(row.previous_total_ms);
      if (calls <= 0 || totalMs < 0) return []; // counter reset/replacement
      const meanMs = totalMs / calls;
      if (!Number.isFinite(meanMs)) return [];
      return [{
        sql: row.query_text ?? "(Normalized SQL no longer available)",
        operation: row.operation,
        classification: row.classification === "maintenance" ? "maintenance" as const : "application" as const,
        calls, meanMs, totalMs,
      }];
    }).sort((a,b) => b.totalMs - a.totalMs);
    return {
      status: "ready", from: baseline.captured_at, to: latest.captured_at, queries,
      detail: "Measured changes between actual samples; historical November 3 calls are excluded.",
      ...metrics,
    };
  } catch {
    return {
      status: "unavailable", from: null, to: null, queries: [],
      detail: "Query snapshots are unavailable. Confirm the DEV migration is applied; app operation is unaffected.",
      ...empty,
    };
  }
}
