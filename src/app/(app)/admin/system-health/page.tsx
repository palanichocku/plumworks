import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DatabaseSizeRow = {
  database_name: string;
  size_bytes: bigint;
  pretty_size: string;
};

type SessionRow = {
  total: bigint;
  active: bigint;
  idle: bigint;
  max_connections: number;
};

type TableSizeRow = {
  table_name: string;
  size_bytes: bigint;
  pretty_size: string;
};

type SlowQueryRow = {
  query: string;
  mean_exec_time: number;
  calls: bigint;
};

type HealthData = {
  databaseOk: boolean;
  databaseLatencyMs: number | null;
  databaseName: string | null;
  databaseSizeBytes: number | null;
  databasePrettySize: string | null;
  sessions: {
    total: number;
    active: number;
    idle: number;
    max: number;
  } | null;
  largestTables: Array<{
    name: string;
    sizeBytes: number;
    prettySize: string;
  }>;
  slowQueries: Array<{
    query: string;
    meanMs: number;
    calls: number;
  }> | null;
};

function toNumber(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

async function getHealthData(): Promise<HealthData> {
  const started = performance.now();
  let databaseLatencyMs: number | null = null;
  let databaseOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseOk = true;
    databaseLatencyMs = Math.round(performance.now() - started);
  } catch {
    return {
      databaseOk: false,
      databaseLatencyMs: null,
      databaseName: null,
      databaseSizeBytes: null,
      databasePrettySize: null,
      sessions: null,
      largestTables: [],
      slowQueries: null,
    };
  }

  let databaseName: string | null = null;
  let databaseSizeBytes: number | null = null;
  let databasePrettySize: string | null = null;
  let sessions: HealthData["sessions"] = null;
  let largestTables: HealthData["largestTables"] = [];
  let slowQueries: HealthData["slowQueries"] = null;

  try {
    const rows = await prisma.$queryRaw<DatabaseSizeRow[]>`
      SELECT
        current_database() AS database_name,
        pg_database_size(current_database()) AS size_bytes,
        pg_size_pretty(pg_database_size(current_database())) AS pretty_size
    `;
    const row = rows[0];
    if (row) {
      databaseName = row.database_name;
      databaseSizeBytes = toNumber(row.size_bytes);
      databasePrettySize = row.pretty_size;
    }
  } catch {
    // Keep the dashboard available even if this diagnostic query is restricted.
  }

  try {
    const rows = await prisma.$queryRaw<SessionRow[]>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE state = 'active')::bigint AS active,
        COUNT(*) FILTER (WHERE state = 'idle')::bigint AS idle,
        current_setting('max_connections')::int AS max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY current_setting('max_connections')
    `;
    const row = rows[0];
    if (row) {
      sessions = {
        total: toNumber(row.total),
        active: toNumber(row.active),
        idle: toNumber(row.idle),
        max: Number(row.max_connections),
      };
    }
  } catch {
    // Some managed database roles restrict pg_stat_activity details.
  }

  try {
    const rows = await prisma.$queryRaw<TableSizeRow[]>`
      SELECT
        relname AS table_name,
        pg_total_relation_size(relid) AS size_bytes,
        pg_size_pretty(pg_total_relation_size(relid)) AS pretty_size
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 8
    `;
    largestTables = rows.map((row) => ({
      name: row.table_name,
      sizeBytes: toNumber(row.size_bytes),
      prettySize: row.pretty_size,
    }));
  } catch {
    // Keep this diagnostic optional.
  }

  try {
    const rows = await prisma.$queryRaw<SlowQueryRow[]>`
      SELECT
        LEFT(regexp_replace(query, '\\s+', ' ', 'g'), 180) AS query,
        mean_exec_time::float8 AS mean_exec_time,
        calls::bigint AS calls
      FROM pg_stat_statements
      WHERE mean_exec_time >= 500
        AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY mean_exec_time DESC
      LIMIT 8
    `;
    slowQueries = rows.map((row) => ({
      query: row.query,
      meanMs: Number(row.mean_exec_time),
      calls: toNumber(row.calls),
    }));
  } catch {
    // pg_stat_statements is optional and may not be enabled or readable.
  }

  return {
    databaseOk,
    databaseLatencyMs,
    databaseName,
    databaseSizeBytes,
    databasePrettySize,
    sessions,
    largestTables,
    slowQueries,
  };
}

function StatusDot({ tone }: { tone: "good" | "warn" | "bad" | "neutral" }) {
  const color = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    neutral: "bg-slate-400",
  }[tone];
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />;
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
        <StatusDot tone={tone} />
        {label}
      </div>
      <div className="text-2xl font-black tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-500">{detail}</div>
    </div>
  );
}

export default async function SystemHealthPage() {
  const health = await getHealthData();
  const updatedAt = new Date();
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local";
  const configuredCapacityGb = Number(process.env.SYSTEM_HEALTH_DB_CAPACITY_GB ?? "");
  const configuredCapacityBytes = Number.isFinite(configuredCapacityGb) && configuredCapacityGb > 0
    ? configuredCapacityGb * 1024 ** 3
    : null;
  const storagePercent = health.databaseSizeBytes !== null && configuredCapacityBytes
    ? (health.databaseSizeBytes / configuredCapacityBytes) * 100
    : null;
  const storageTone = storagePercent === null
    ? "neutral"
    : storagePercent >= 85
      ? "bad"
      : storagePercent >= 70
        ? "warn"
        : "good";
  const sessionPercent = health.sessions && health.sessions.max > 0
    ? (health.sessions.total / health.sessions.max) * 100
    : null;
  const sessionTone = sessionPercent === null
    ? "neutral"
    : sessionPercent >= 80
      ? "bad"
      : sessionPercent >= 65
        ? "warn"
        : "good";
  const globalTone = !health.databaseOk || storageTone === "bad" || sessionTone === "bad"
    ? "bad"
    : storageTone === "warn" || sessionTone === "warn"
      ? "warn"
      : "good";
  const globalLabel = globalTone === "bad" ? "Action required" : globalTone === "warn" ? "Warning" : "Core systems healthy";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Operations"
        title="System Health"
        description="Early-warning signals for availability, database capacity, and recoverability."
      />

      <section className={`flex flex-col gap-2 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        globalTone === "bad"
          ? "border-red-200 bg-red-50"
          : globalTone === "warn"
            ? "border-amber-200 bg-amber-50"
            : "border-emerald-200 bg-emerald-50"
      }`}>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <StatusDot tone={globalTone} />
          {globalLabel}
        </div>
        <div className="text-xs font-semibold text-slate-500">
          {environment} · Updated {formatTimestamp(updatedAt)}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Database"
          value={health.databaseOk ? "Connected" : "Unavailable"}
          detail={health.databaseLatencyMs !== null ? `${health.databaseLatencyMs} ms connectivity check` : "Connection check failed"}
          tone={health.databaseOk ? "good" : "bad"}
        />
        <MetricCard
          label="Database storage"
          value={health.databasePrettySize ?? (health.databaseSizeBytes !== null ? formatBytes(health.databaseSizeBytes) : "Unavailable")}
          detail={storagePercent !== null
            ? `${storagePercent.toFixed(1)}% of ${configuredCapacityGb} GB configured capacity`
            : "Current usage shown; capacity limit not configured"}
          tone={storageTone}
        />
        <MetricCard
          label="Database sessions"
          value={health.sessions ? `${health.sessions.total} / ${health.sessions.max}` : "Unavailable"}
          detail={health.sessions ? `${health.sessions.active} active · ${health.sessions.idle} idle` : "Session statistics are restricted"}
          tone={sessionTone}
        />
        <MetricCard
          label="Deployment"
          value={commitSha}
          detail={`${environment} release`}
          tone="neutral"
        />
      </section>

      {storagePercent !== null && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Database capacity</h2>
              <p className="text-sm font-medium text-slate-500">Warn at 70%; critical at 85%.</p>
            </div>
            <div className="text-sm font-black text-slate-700">{storagePercent.toFixed(1)}%</div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${storageTone === "bad" ? "bg-red-500" : storageTone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(storagePercent, 100)}%` }}
            />
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-black text-slate-900">Largest database tables</h2>
            <p className="text-sm font-medium text-slate-500">Useful for spotting audit/history data that is growing unexpectedly.</p>
          </div>
          {health.largestTables.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {health.largestTables.map((table) => (
                <div key={table.name} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span className="min-w-0 truncate font-semibold text-slate-700">{table.name}</span>
                  <span className="shrink-0 font-black text-slate-900">{table.prettySize || formatBytes(table.sizeBytes)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Table-size diagnostics are unavailable for this database role.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-black text-slate-900">Protection & monitoring</h2>
            <p className="text-sm font-medium text-slate-500">A healthy app is only protected if its monitors and recovery path are also working.</p>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-3">
              <div><div className="font-bold text-slate-800">Better Stack</div><div className="text-slate-500">External uptime and /api/health alerts</div></div>
              <span className="shrink-0 font-bold text-slate-500">Not connected</span>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-3">
              <div><div className="font-bold text-slate-800">Checkly</div><div className="text-slate-500">Real user-journey monitoring</div></div>
              <span className="shrink-0 font-bold text-slate-500">Not connected</span>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-3">
              <div><div className="font-bold text-slate-800">Scheduled health job</div><div className="text-slate-500">GitHub Actions monitor heartbeat</div></div>
              <span className="shrink-0 font-bold text-slate-500">Not connected</span>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl bg-slate-50 p-3">
              <div><div className="font-bold text-slate-800">Backup / restore verification</div><div className="text-slate-500">Recovery status requires provider integration</div></div>
              <span className="shrink-0 font-bold text-slate-500">Not connected</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-black text-slate-900">Slow database queries</h2>
          <p className="text-sm font-medium text-slate-500">Queries averaging 500 ms or more, when PostgreSQL query statistics are available.</p>
        </div>
        {health.slowQueries === null ? (
          <p className="rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Query statistics are not enabled or not readable. No sample data is shown.</p>
        ) : health.slowQueries.length === 0 ? (
          <p className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">No queries currently exceed the 500 ms average threshold.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                <tr><th className="pb-3 pr-4">Query</th><th className="pb-3 pr-4">Avg time</th><th className="pb-3">Calls</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {health.slowQueries.map((query, index) => (
                  <tr key={`${query.query}-${index}`}>
                    <td className="max-w-3xl py-3 pr-4 font-mono text-xs text-slate-700">{query.query}</td>
                    <td className="py-3 pr-4 font-black text-amber-700">{Math.round(query.meanMs)} ms</td>
                    <td className="py-3 font-semibold text-slate-700">{query.calls.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">
        <strong>Next additions:</strong> live Better Stack/Checkly status, backup verification, storage-growth history/forecasting, and application 5xx trends. They are intentionally not represented with sample values until a reliable data source is connected.
      </div>

      <p className="text-xs font-medium text-slate-400">Database: {health.databaseName ?? "unknown"}</p>
    </div>
  );
}
