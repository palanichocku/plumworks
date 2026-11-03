import { Suspense } from "react";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { getExternalHealth, getBackupHealth, type MonitorTone } from "@/lib/system-health/external";

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
  total_exec_time: number;
  calls: bigint;
};

type SnapshotRow = {
  snapshot_date: string;
  database_size_bytes: bigint;
  table_sizes: unknown;
};

type TableInfo = {
  name: string;
  sizeBytes: number;
  prettySize: string;
};

type SlowQuery = {
  operation: "SELECT" | "DELETE";
  query: string;
  meanMs: number;
  totalMs: number;
  calls: number;
};

type Snapshot = {
  date: string;
  databaseSizeBytes: number;
  tableSizes: Record<string, number>;
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
  largestTables: TableInfo[];
  slowQueries: SlowQuery[] | null;
  snapshots: Snapshot[];
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

function formatDuration(ms: number) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
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

function parseTableSizes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, size]) => [key, Number(size)] as const)
      .filter(([, size]) => Number.isFinite(size) && size >= 0),
  );
}

async function ensureDevSnapshotStorage() {
  if (process.env.VERCEL_ENV === "production") return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS system_health_snapshots (
        snapshot_date date PRIMARY KEY,
        database_size_bytes bigint NOT NULL,
        table_sizes jsonb NOT NULL,
        captured_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch {
    // DEV convenience only. Snapshot history is optional and must never block System Health.
  }
}

async function saveAndReadSnapshots(databaseSizeBytes: number | null, tables: TableInfo[]) {
  await ensureDevSnapshotStorage();

  if (databaseSizeBytes !== null) {
    try {
      const tableSizes = JSON.stringify(Object.fromEntries(tables.map((table) => [table.name, table.sizeBytes])));
      await prisma.$executeRaw`
        INSERT INTO system_health_snapshots (snapshot_date, database_size_bytes, table_sizes, captured_at)
        VALUES (CURRENT_DATE, ${databaseSizeBytes}, ${tableSizes}::jsonb, now())
        ON CONFLICT (snapshot_date) DO UPDATE
        SET database_size_bytes = EXCLUDED.database_size_bytes,
            table_sizes = EXCLUDED.table_sizes,
            captured_at = now()
      `;
    } catch {
      // Best-effort history only. Current health remains available if this write is restricted.
    }
  }

  try {
    const rows = await prisma.$queryRaw<SnapshotRow[]>`
      SELECT
        snapshot_date::text AS snapshot_date,
        database_size_bytes,
        table_sizes
      FROM system_health_snapshots
      WHERE snapshot_date >= CURRENT_DATE - INTERVAL '125 days'
      ORDER BY snapshot_date ASC
    `;
    return rows.map((row) => ({
      date: row.snapshot_date,
      databaseSizeBytes: toNumber(row.database_size_bytes),
      tableSizes: parseTableSizes(row.table_sizes),
    }));
  } catch {
    return [];
  }
}

async function getHealthData(): Promise<HealthData> {
  const started = performance.now();
  let databaseLatencyMs: number | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
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
      snapshots: [],
    };
  }

  let databaseName: string | null = null;
  let databaseSizeBytes: number | null = null;
  let databasePrettySize: string | null = null;
  let sessions: HealthData["sessions"] = null;
  let largestTables: TableInfo[] = [];
  let slowQueries: SlowQuery[] | null = null;

  const [databaseSizeResult, sessionsResult, tablesResult, slowQueriesResult] = await Promise.allSettled([
    prisma.$queryRaw<DatabaseSizeRow[]>`
      SELECT
        current_database() AS database_name,
        pg_database_size(current_database()) AS size_bytes,
        pg_size_pretty(pg_database_size(current_database())) AS pretty_size
    `,
    prisma.$queryRaw<SessionRow[]>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE state = 'active')::bigint AS active,
        COUNT(*) FILTER (WHERE state = 'idle')::bigint AS idle,
        current_setting('max_connections')::int AS max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY current_setting('max_connections')
    `,
    prisma.$queryRaw<TableSizeRow[]>`
      SELECT
        relname AS table_name,
        pg_total_relation_size(relid) AS size_bytes,
        pg_size_pretty(pg_total_relation_size(relid)) AS pretty_size
      FROM pg_catalog.pg_statio_user_tables
      WHERE relname <> 'system_health_snapshots'
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `,
    prisma.$queryRaw<SlowQueryRow[]>`
      SELECT
        regexp_replace(query, '\\s+', ' ', 'g') AS query,
        mean_exec_time::float8 AS mean_exec_time,
        total_exec_time::float8 AS total_exec_time,
        calls::bigint AS calls
      FROM pg_stat_statements
      WHERE mean_exec_time >= 500
        AND query NOT ILIKE '%pg_stat_statements%'
        -- Heuristic scope: PostgreSQL aggregates by DB role, not request origin.
        AND calls >= 2
        AND query ~* '(customers|vehicles|repair_orders|repair_order_parts|repair_order_labor|invoices|invoice_parts|invoice_labor|payments|accounts_receivable|marketing_leads|marketing_lead_notifications|audit_logs|shops|shop_memberships|canned_services|vendors|employees)'
        AND query !~* '(raw_legacy|legacy_|_prisma_migrations|system_health_snapshots|pg_catalog|information_schema|pg_stat_|pg_database_size|shopman|cutover|import_runs|import_errors|ordtemps)'
        AND (
          UPPER(LEFT(LTRIM(query), 6)) = 'SELECT'
          OR UPPER(LEFT(LTRIM(query), 6)) = 'DELETE'
        )
      ORDER BY total_exec_time DESC
      LIMIT 12
    `,
  ]);

  if (databaseSizeResult.status === "fulfilled") {
    const row = databaseSizeResult.value[0];
    if (row) {
      databaseName = row.database_name;
      databaseSizeBytes = toNumber(row.size_bytes);
      databasePrettySize = row.pretty_size;
    }
  }

  if (sessionsResult.status === "fulfilled") {
    const row = sessionsResult.value[0];
    if (row) {
      sessions = {
        total: toNumber(row.total),
        active: toNumber(row.active),
        idle: toNumber(row.idle),
        max: Number(row.max_connections),
      };
    }
  }

  if (tablesResult.status === "fulfilled") {
    largestTables = tablesResult.value.map((row) => ({
      name: row.table_name,
      sizeBytes: toNumber(row.size_bytes),
      prettySize: row.pretty_size,
    }));
  }

  if (slowQueriesResult.status === "fulfilled") {
    slowQueries = slowQueriesResult.value.map((row) => {
      const normalized = row.query.trim();
      const operation = normalized.slice(0, 6).toUpperCase() === "DELETE" ? "DELETE" as const : "SELECT" as const;
      return {
        operation,
        query: normalized,
        meanMs: Number(row.mean_exec_time),
        totalMs: Number(row.total_exec_time),
        calls: toNumber(row.calls),
      };
    });
  }

  const snapshots = await saveAndReadSnapshots(databaseSizeBytes, largestTables);

  return {
    databaseOk: true,
    databaseLatencyMs,
    databaseName,
    databaseSizeBytes,
    databasePrettySize,
    sessions,
    largestTables,
    slowQueries,
    snapshots,
  };
}

function StatusDot({ tone }: { tone: MonitorTone }) {
  const color = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    neutral: "bg-slate-400",
  }[tone];
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />;
}

function MetricCard({ label, value, detail, tone = "neutral" }: {
  label: string;
  value: string;
  detail: string;
  tone?: MonitorTone;
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

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthColumns() {
  const now = new Date();
  return [2, 1, 0].map((monthsAgo) => {
    const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
    };
  });
}

function monthlyLatestSnapshots(snapshots: Snapshot[]) {
  const byMonth = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    const date = new Date(`${snapshot.date}T12:00:00`);
    if (!Number.isNaN(date.getTime())) byMonth.set(monthKey(date), snapshot);
  }
  return byMonth;
}

function growthPercent(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined || previous <= 0) return null;
  return (current - previous) / previous * 100;
}

function GrowthValue({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const tone = value >= 20 ? "text-amber-700" : value < 0 ? "text-emerald-700" : "text-slate-700";
  return <span className={`font-bold ${tone}`}>{value >= 0 ? "+" : ""}{value.toFixed(1)}%</span>;
}

function queryAction(query: SlowQuery) {
  if (query.meanMs >= 3_000) return { label: "Priority", tone: "bad" as const, advice: "Review the execution plan and indexing before this query becomes an outage risk." };
  if (query.meanMs >= 1_000 || query.totalMs >= 60_000) return { label: "Action", tone: "warn" as const, advice: "Check indexes and the execution plan; frequency makes this query operationally significant." };
  if (query.calls >= 50) return { label: "Investigate", tone: "warn" as const, advice: "The query is moderately slow and frequent. Optimize if it appears in a customer-facing workflow." };
  return { label: "Watch", tone: "neutral" as const, advice: "Slow, but currently low-frequency. Revisit if calls or total database time rise." };
}

function toneClasses(tone: MonitorTone) {
  return {
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    bad: "border-red-200 bg-red-50 text-red-800",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
}

async function ProtectionMonitoring() {
  const [{ betterStack, checkly, resend }, backup] = await Promise.all([
    getExternalHealth(),
    getBackupHealth(),
  ]);
  const cards = [betterStack, checkly, backup, resend];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-black text-slate-900">Protection & monitoring</h2>
        <p className="text-sm font-medium text-slate-500">External checks are cached for 5 minutes, run only on this page, and time out after 2 seconds without affecting PlumWorks workflows.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <div key={card.name} className={`rounded-xl border p-4 ${toneClasses(card.tone)}`}>
            <div className="flex items-center gap-2 text-sm font-black">
              <StatusDot tone={card.tone} />
              {card.name}
            </div>
            <div className="mt-2 text-lg font-black">{card.value}</div>
            <div className="mt-1 text-xs font-semibold opacity-75">{card.detail}</div>
            {card.checks && card.checks.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-current/10 pt-3">
                <div className="text-[11px] font-black uppercase tracking-wider opacity-70">
                  {card.name === "Better Stack" ? "What is monitored" : "Configured checks"}
                </div>
                {card.checks.map((check, index) => (
                  <div key={index} className="rounded-lg border border-current/10 bg-white/70 p-2.5 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-1.5">
                      <span className="font-bold break-words">{check.name}</span>
                      <span className="shrink-0 font-semibold">{check.status}</span>
                    </div>
                    <div className="mt-1 opacity-75">
                      {check.type}{check.target ? ` · ${check.target}` : ""}
                    </div>
                    {check.checkedAt && <div className="mt-1 opacity-70">{card.name === "Checkly" ? "Status updated" : "Last checked"}: {check.checkedAt}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ProtectionMonitoringFallback() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-black text-slate-900">Protection & monitoring</h2>
      <p className="mt-2 text-sm font-medium text-slate-500">Loading cached external status…</p>
    </section>
  );
}

export default async function SystemHealthPage() {
  const health = await getHealthData();
  const updatedAt = new Date();
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local";
  const plan = process.env.SYSTEM_HEALTH_SUPABASE_PLAN === "pro" ? "pro" : process.env.SYSTEM_HEALTH_SUPABASE_PLAN === "free" ? "free" : process.env.VERCEL_ENV === "production" ? "pro" : "free";
  const configuredCapacityGb = Number(process.env.SYSTEM_HEALTH_DB_CAPACITY_GB ?? (plan === "free" ? "0.5" : "8"));
  const configuredCapacityBytes = Number.isFinite(configuredCapacityGb) && configuredCapacityGb > 0 ? configuredCapacityGb * 1024 ** 3 : null;
  const storagePercent = health.databaseSizeBytes !== null && configuredCapacityBytes ? health.databaseSizeBytes / configuredCapacityBytes * 100 : null;
  const storageTone: MonitorTone = storagePercent === null ? "neutral" : storagePercent >= 85 ? "bad" : storagePercent >= 70 ? "warn" : "good";
  const sessionPercent = health.sessions && health.sessions.max > 0 ? health.sessions.total / health.sessions.max * 100 : null;
  const sessionTone: MonitorTone = sessionPercent === null ? "neutral" : sessionPercent >= 80 ? "bad" : sessionPercent >= 65 ? "warn" : "good";
  const globalTone: MonitorTone = !health.databaseOk || storageTone === "bad" || sessionTone === "bad" ? "bad" : storageTone === "warn" || sessionTone === "warn" ? "warn" : "good";
  const globalLabel = globalTone === "bad" ? "Action required" : globalTone === "warn" ? "Warning" : "Core systems healthy";
  const columns = monthColumns();
  const monthSnapshots = monthlyLatestSnapshots(health.snapshots);

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading
        eyebrow="Operations"
        title="System Health"
        description="Early-warning signals for availability, database capacity, monitoring, and performance."
      />

      <section className={`flex flex-col gap-2 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${toneClasses(globalTone)}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          <StatusDot tone={globalTone} />
          {globalLabel}
        </div>
        <div className="text-xs font-semibold opacity-70">{environment} · Updated {formatTimestamp(updatedAt)}</div>
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
          value={health.databaseSizeBytes === null ? "Unavailable" : `${formatBytes(health.databaseSizeBytes)} / ${configuredCapacityBytes ? formatBytes(configuredCapacityBytes) : "—"}`}
          detail={storagePercent !== null ? `${storagePercent.toFixed(1)}% of ${plan === "free" ? "Free DB allowance" : "Pro included disk reference"} · warn at 70% · critical at 85%` : "Usage is live; set the project capacity to enable limit warnings"}
          tone={storageTone}
        />
        <MetricCard
          label="Database sessions"
          value={health.sessions ? `${health.sessions.total} / ${health.sessions.max}` : "Unavailable"}
          detail={health.sessions ? `${health.sessions.active} active · ${health.sessions.idle} idle` : "Session statistics are restricted"}
          tone={sessionTone}
        />
        <MetricCard label="Deployment" value={commitSha} detail={`${environment} release`} tone="neutral" />
      </section>

      {storagePercent !== null && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900">Database capacity</h2>
              <p className="text-sm font-medium text-slate-500">{plan === "free" ? "Free database-size allowance (not physical disk utilization)." : "Pro reference is the included 8 GB disk; actual disk usage and autoscaling are tracked in Supabase."}</p>
            </div>
            <div className="text-sm font-black text-slate-700">{storagePercent.toFixed(1)}%</div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${storageTone === "bad" ? "bg-red-500" : storageTone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(storagePercent, 100)}%` }} />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-black text-slate-900">Largest database tables</h2>
          <p className="text-sm font-medium text-slate-500">Current size plus month-over-month growth. History begins when snapshots are collected; prior months are never estimated.</p>
        </div>
        {health.largestTables.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs font-black uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-3 pr-4">Table</th>
                  <th className="pb-3 pr-4 text-right">Current</th>
                  {columns.map((column) => <th key={column.key} className="pb-3 pl-4 text-right">{column.label} growth</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {health.largestTables.map((table) => (
                  <tr key={table.name}>
                    <td className="py-3 pr-4 font-semibold text-slate-700">{table.name}</td>
                    <td className="py-3 pr-4 text-right font-black text-slate-900">{table.prettySize || formatBytes(table.sizeBytes)}</td>
                    {columns.map((column, index) => {
                      const current = monthSnapshots.get(column.key)?.tableSizes[table.name];
                      const previousDate = new Date();
                      previousDate.setDate(1);
                      previousDate.setMonth(previousDate.getMonth() - (columns.length - index));
                      const previous = monthSnapshots.get(monthKey(previousDate))?.tableSizes[table.name];
                      return <td key={column.key} className="py-3 pl-4 text-right"><GrowthValue value={growthPercent(current, previous)} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {health.snapshots.length < 2 && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-500">Growth history is collecting now. At least two month-end periods are required before a true month-over-month percentage appears.</p>}
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Table-size diagnostics are unavailable for this database role.</p>
        )}
      </section>

      <Suspense fallback={<ProtectionMonitoringFallback />}>
        <ProtectionMonitoring />
      </Suspense>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-black text-slate-900">Slow database queries</h2>
          <p className="text-sm font-medium text-slate-500">SELECT and DELETE statements averaging at least 500 ms. Prioritize average latency, frequency, and total database time together.</p>
        </div>
        {health.slowQueries === null ? (
          <p className="rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-500">Slow-query statistics are unavailable. pg_stat_statements may be disabled or restricted.</p>
        ) : health.slowQueries.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">No SELECT or DELETE queries currently average 500 ms or more.</div>
        ) : (
          <div className="space-y-2">
            {health.slowQueries.map((query, index) => {
              const action = queryAction(query);
              return (
                <details key={`${query.operation}-${index}`} className="group rounded-xl border border-slate-200 bg-white open:bg-slate-50">
                  <summary className="cursor-pointer list-none p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-center">
                      <div className={`w-fit rounded-lg border px-2 py-1 text-xs font-black ${toneClasses(query.operation === "DELETE" ? "warn" : "neutral")}`}>{query.operation}</div>
                      <div><div className="text-xs font-bold uppercase text-slate-400">Average</div><div className="font-black text-slate-900">{formatDuration(query.meanMs)}</div></div>
                      <div><div className="text-xs font-bold uppercase text-slate-400">Calls</div><div className="font-black text-slate-900">{query.calls.toLocaleString()}</div></div>
                      <div><div className="text-xs font-bold uppercase text-slate-400">Total DB time</div><div className="font-black text-slate-900">{formatDuration(query.totalMs)}</div></div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end"><span className={`rounded-lg border px-2 py-1 text-xs font-black ${toneClasses(action.tone)}`}>{action.label}</span><span className="text-slate-400 transition-transform group-open:rotate-180">⌄</span></div>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200 px-4 pb-4 pt-3">
                    <p className="mb-3 text-xs font-semibold text-slate-600">{action.advice}</p>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{query.query}</pre>
                  </div>
                </details>
              );
            })}
          </div>
        )}
        <div className="mt-4 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-2">Under 500 ms: hidden</div>
          <div className="rounded-lg bg-slate-50 p-2">500 ms–1 s: watch frequency</div>
          <div className="rounded-lg bg-amber-50 p-2 text-amber-700">1–3 s: investigate</div>
          <div className="rounded-lg bg-red-50 p-2 text-red-700">3 s+: priority</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold leading-5 text-slate-500">
        Safety: this page is read-mostly and isolated from customer workflows. External providers are loaded separately, cached for five minutes, and hard-timeout after two seconds. A provider outage cannot block Repair Orders, invoices, leads, the public website, or the core System Health database view.
      </section>
    </div>
  );
}
