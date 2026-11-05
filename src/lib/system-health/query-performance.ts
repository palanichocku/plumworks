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
  coveredHours: number;
  intervals: Array<{ from: string; to: string; gapMinutes: number }>;
  trend: Array<{ timestamp: string; maxMeanMs: number; calls: number; gapMinutes: number }>;
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
  const empty = {
    latestAt: null, sampleCount: 0, maximumGapMinutes: null, observedHours: 0,
    coveredHours: 0, intervals: [], trend: [],
  };
  try {
    const history = await prisma.$queryRaw<{ id: string; captured_at: Date; stats_reset_at: Date }[]>`
      SELECT id, captured_at, stats_reset_at
      FROM system_health_query_snapshots
      WHERE captured_at >= now() - interval '24 hours'
      ORDER BY captured_at ASC LIMIT 144
    `;
    const stampTimes = history.map((row) => new Date(row.captured_at).getTime());
    const gaps = stampTimes.slice(1).map((stamp, i) => (stamp - stampTimes[i]) / 60_000);
    const maximumGapMinutes = gaps.length ? Math.max(...gaps) : null;
    const observedHours = stampTimes.length >= 2
      ? (stampTimes[stampTimes.length - 1] - stampTimes[0]) / 3_600_000 : 0;
    // Do not treat gaps >90 min or a stats-reset crossing as observed coverage.
    const validIntervals = history.slice(1).flatMap((current, i) => {
      const prior = history[i];
      const gapMinutes = gaps[i];
      if (gapMinutes <= 0 || gapMinutes > 90
        || new Date(current.stats_reset_at).getTime() !== new Date(prior.stats_reset_at).getTime()) return [];
      return [{ from: prior.captured_at.toISOString(), to: current.captured_at.toISOString(), gapMinutes }];
    });
    const coveredHours = validIntervals.reduce((sum, interval) => sum + interval.gapMinutes / 60, 0);
    const metrics = {
      latestAt: history.length ? history[history.length - 1].captured_at : null,
      sampleCount: history.length, maximumGapMinutes, observedHours,
      coveredHours, intervals: validIntervals, trend: [] as QueryPerformanceWindow["trend"],
    };

    const latest = history[history.length - 1];
    const baseline = history[0];
    if (!latest) return {
      status: "collecting", from: null, to: null, queries: [],
      detail: "No samples yet. Capture a baseline to begin monitoring.", ...metrics,
    };
    if (!baseline || latest.id === baseline.id) return {
      status: "collecting", from: latest.captured_at, to: null, queries: [],
      detail: "Baseline captured. A second snapshot is required.", ...metrics,
    };
    if (new Date(latest.stats_reset_at).getTime() !== new Date(baseline.stats_reset_at).getTime()) return {
      status: "reset", from: baseline.captured_at, to: latest.captured_at, queries: [],
      detail: "PostgreSQL statistics were reset. Capture a new baseline after the reset.", ...metrics,
    };

    // Only compare matching counters from the oldest and newest snapshots;
    // historical November 3 activity predating the baseline is excluded.
    const [rows, trendRows] = await Promise.all([
      prisma.$queryRaw<(Sample & { previous_calls: bigint | null; previous_total_ms: number | null })[]>`
        SELECT n.db_id, n.user_id, n.query_id, n.operation, n.classification,
               left(stats.query, 4000) AS query_text, n.calls, n.total_exec_ms,
               p.calls AS previous_calls, p.total_exec_ms AS previous_total_ms
        FROM system_health_query_samples n
        LEFT JOIN pg_stat_statements stats
          ON stats.dbid::bigint = n.db_id AND stats.userid::bigint = n.user_id
         AND stats.queryid::text = n.query_id
        LEFT JOIN system_health_query_samples p
          ON p.snapshot_id = ${baseline.id}::uuid
         AND p.db_id = n.db_id AND p.user_id = n.user_id AND p.query_id = n.query_id
        WHERE n.snapshot_id = ${latest.id}::uuid
      `,
      prisma.$queryRaw<{ captured_at: Date; max_mean_ms: number | null; app_calls: bigint | null; gap_minutes: number }[]>`
        WITH ordered AS (
          SELECT id, captured_at, stats_reset_at,
                 lag(id) OVER (ORDER BY captured_at) AS previous_id,
                 lag(captured_at) OVER (ORDER BY captured_at) AS previous_at,
                 lag(stats_reset_at) OVER (ORDER BY captured_at) AS previous_reset
          FROM system_health_query_snapshots
          WHERE captured_at >= now() - interval '24 hours'
        ), deltas AS (
          SELECT o.captured_at, EXTRACT(EPOCH FROM (o.captured_at - o.previous_at)) / 60 AS gap_minutes,
                 n.classification,
                 (n.calls - p.calls) AS new_calls,
                 (n.total_exec_ms - p.total_exec_ms) AS new_ms
          FROM ordered o
          JOIN system_health_query_samples n ON n.snapshot_id = o.id
          JOIN system_health_query_samples p
            ON p.snapshot_id = o.previous_id
           AND p.db_id = n.db_id AND p.user_id = n.user_id AND p.query_id = n.query_id
          WHERE o.previous_id IS NOT NULL
            AND o.stats_reset_at = o.previous_reset
            AND o.captured_at > o.previous_at
            AND o.captured_at - o.previous_at <= interval '90 minutes'
            AND n.calls > p.calls AND n.total_exec_ms >= p.total_exec_ms
        )
        SELECT captured_at,
               MAX((new_ms / NULLIF(new_calls, 0))::float8)
                 FILTER (WHERE classification = 'application') AS max_mean_ms,
               (SUM(new_calls) FILTER (WHERE classification = 'application'))::bigint AS app_calls,
               MAX(gap_minutes)::float8 AS gap_minutes
        FROM deltas
        GROUP BY captured_at
        ORDER BY captured_at ASC
      `,
    ]);
    const queries: RecentQuery[] = rows.flatMap((row) => {
      if (row.previous_calls === null || row.previous_total_ms === null) return [];
      const calls = Number(row.calls - row.previous_calls);
      const totalMs = Number(row.total_exec_ms) - Number(row.previous_total_ms);
      if (calls <= 0 || totalMs < 0) return [];
      const meanMs = totalMs / calls;
      if (!Number.isFinite(meanMs)) return [];
      return [{
        sql: row.query_text ?? "(Normalized SQL no longer available)",
        operation: row.operation,
        classification: row.classification === "maintenance" ? "maintenance" as const : "application" as const,
        calls, meanMs, totalMs,
      }];
    }).sort((a,b) => b.totalMs - a.totalMs);
    const trend = trendRows.filter(r => r.max_mean_ms !== null).map(row => ({
      timestamp: row.captured_at.toISOString(),
      maxMeanMs: Math.max(0, row.max_mean_ms ?? 0),
      calls: Number(row.app_calls ?? 0),
      gapMinutes: row.gap_minutes,
    }));
    const stale = Date.now() - new Date(latest.captured_at).getTime() > 150 * 60_000;
    return {
      status: stale ? "stale" : "ready",
      from: baseline.captured_at, to: latest.captured_at, queries,
      detail: stale ? "Latest sample is older than 2½ hours; these measurements are historical."
        : "Recent query deltas only. Coverage and origin classification have limitations.",
      ...metrics, trend,
    };
  } catch {
    return {
      status: "unavailable", from: null, to: null, queries: [],
      detail: "Query performance measurements are unavailable; other application workflows are unaffected.",
      ...empty,
    };
  }
}
