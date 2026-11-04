import { Suspense, type ReactNode } from "react";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { getExternalHealth, getBackupHealth, type MonitorTone } from "@/lib/system-health/external";
import { getRecentQueryPerformance, type RecentQuery } from "@/lib/system-health/query-performance";
import { captureSystemHealthQuerySnapshot } from "./query-actions";

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
      snapshots: [],
    };
  }

  let databaseName: string | null = null;
  let databaseSizeBytes: number | null = null;
  let databasePrettySize: string | null = null;
  let sessions: HealthData["sessions"] = null;
  let largestTables: TableInfo[] = [];

  const [databaseSizeResult, sessionsResult, tablesResult] = await Promise.allSettled([
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

  const snapshots = await saveAndReadSnapshots(databaseSizeBytes, largestTables);

  return {
    databaseOk: true,
    databaseLatencyMs,
    databaseName,
    databaseSizeBytes,
    databasePrettySize,
    sessions,
    largestTables,
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

function MetricCard({ label, value, detail, tone = "neutral", children }: {
  label: string;
  value: string;
  detail: string;
  tone?: MonitorTone;
  children?: ReactNode;
}) {
  const status = { good: "Healthy", warn: "Warning", bad: "Critical", neutral: "Info" }[tone];
  const statusStyle = {
    good: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-800",
    bad: "bg-red-50 text-red-800",
    neutral: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold ${statusStyle}`}>
          <StatusDot tone={tone} />{status}
        </span>
      </div>
      <div className="mt-3 break-words text-[clamp(1.3rem,2.4vw,1.8rem)] font-black tracking-tight text-slate-950 tabular-nums">{value}</div>
      <div className="mt-2 text-xs font-medium leading-5 text-slate-600">{detail}</div>
      {children}
    </article>
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

function recentQueryPriority(query: RecentQuery) {
  if (query.classification === "maintenance") return { label: "Maintenance", tone: "neutral" as const };
  if (query.meanMs >= 3_000) return { label: "Priority", tone: "bad" as const };
  if (query.meanMs >= 1_000 && query.calls >= 3) return { label: "Action", tone: "warn" as const };
  if (query.meanMs >= 500 && query.calls >= 3) return { label: "Watch", tone: "neutral" as const };
  return { label: "Normal", tone: "good" as const };
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
  const statusNames: Record<MonitorTone, string> = {
    good: "Passing", warn: "Attention", bad: "Failing", neutral: "Unavailable / info",
  };
  return (
    <section id="monitoring" aria-labelledby="monitor-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 id="monitor-heading" className="text-base font-black tracking-tight text-slate-950">Protection & monitoring</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">Provider statuses are cached for 1–5 minutes and retrieved with a five-second timeout. These checks never block normal shop workflows.</p>
      </div>
      <div className="divide-y divide-slate-200">
        {cards.map((card) => (
          <div key={card.name} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-slate-900">{card.name}</h3>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold ${toneClasses(card.tone)}`}>
                <StatusDot tone={card.tone} />
                {statusNames[card.tone]}
              </span>
            </div>
            <p className="mt-1 text-sm font-extrabold leading-5 text-slate-900">{card.value}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{card.detail}</p>
            {card.checks && card.checks.length > 0 && (
              <div className="mt-3 space-y-2">
                {card.checks.map((check, index) => (
                  <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 break-words font-bold text-slate-800">{check.name}</span>
                      <span className="font-bold text-slate-700">{check.status}</span>
                    </div>
                    <p className="mt-1 break-all leading-5 text-slate-600">{check.type}{check.target ? ` · ${check.target}` : ""}</p>
                    {check.checkedAt && <p className="mt-1 text-slate-500">{card.name === "Checkly" ? "Status updated" : "Checked"}: {check.checkedAt}</p>}
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
  const [health, queryWindow] = await Promise.all([getHealthData(), getRecentQueryPerformance()]);
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


  const applicationActivity = queryWindow.queries.filter((query) => query.classification === "application");
  const maintenanceActivity = queryWindow.queries.filter((query) => query.classification === "maintenance");
  const actionableQueries = queryWindow.status === "ready"
    ? applicationActivity.filter((query) => ["Action", "Priority"].includes(recentQueryPriority(query).label))
    : [];
  const attentionCount = actionableQueries.length + (globalTone !== "good" ? 1 : 0);
  const overallTone: MonitorTone = globalTone === "bad" ? "bad" : attentionCount > 0 ? "warn" : "good";
  const maxTableBytes = Math.max(1, ...health.largestTables.map((table) => table.sizeBytes));
  const legacyTableBytes = health.largestTables.filter((table) => table.name.startsWith("raw_legacy_")).reduce((sum, table) => sum + table.sizeBytes, 0);
  const legacyPercent = health.databaseSizeBytes && legacyTableBytes > 0 ? legacyTableBytes / health.databaseSizeBytes * 100 : null;
  const hasMonthlyGrowth = health.largestTables.some((table) =>
    columns.some((column, index) => {
      const current = monthSnapshots.get(column.key)?.tableSizes[table.name];
      const prior = new Date();
      prior.setDate(1);
      prior.setMonth(prior.getMonth() - (columns.length - index));
      return growthPercent(current, monthSnapshots.get(monthKey(prior))?.tableSizes[table.name]) !== null;
    }),
  );
  const slowAppQueries = applicationActivity.filter((query) => query.meanMs >= 500).sort((a,b) => b.totalMs - a.totalMs);
  const totalListedTime = slowAppQueries.reduce((sum, query) => sum + query.totalMs, 0);
  const maxListedTime = Math.max(1, ...slowAppQueries.map((query) => query.totalMs));

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-5 pb-8 animate-fadeIn sm:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeading
          eyebrow="Operations / Admin diagnostics"
          title="System Health"
          description="Availability, capacity, external monitoring and query performance at a glance."
        />
        <div className="flex flex-wrap items-center gap-2 self-start text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-bold uppercase tracking-wide">{environment}</span>
          <span className="font-medium">Updated {formatTimestamp(updatedAt)}</span>
          <a href="/admin/system-health" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">↻ Refresh</a>
        </div>
      </div>

      <section aria-label="Health summary" className={`flex flex-col gap-3 rounded-2xl border p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between ${toneClasses(overallTone)}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot tone={overallTone} />
            <h2 className="text-lg font-black tracking-tight">{globalTone === "bad" ? "Core system needs attention" : attentionCount > 0 ? "Core available · review recommended" : "Core systems healthy"}</h2>
          </div>
          <p className="mt-1 text-sm leading-5">{health.databaseOk ? "Database reachable. Provider details are reported independently below." : "Database connectivity has failed; investigate immediately."}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          {actionableQueries.length > 0 && <a href="#slow-queries" className="inline-flex min-h-11 items-center rounded-lg border border-current/20 bg-white/85 px-3 py-2 text-xs font-extrabold text-amber-900 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2">{actionableQueries.length} slow {actionableQueries.length === 1 ? "query" : "queries"} to review ↘</a>}
          <a href="#monitoring" className="inline-flex min-h-11 items-center rounded-lg border border-current/20 bg-white/85 px-3 py-2 text-xs font-extrabold text-slate-800 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2">Monitoring details ↘</a>
        </div>
      </section>

      <section aria-label="Database and deployment metrics" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Database connection"
          value={health.databaseOk ? "Connected" : "Unavailable"}
          detail={health.databaseLatencyMs !== null ? `Connectivity check · ${health.databaseLatencyMs} ms` : "Connection check failed"}
          tone={health.databaseOk ? "good" : "bad"}
        />
        <MetricCard
          label="Database storage"
          value={health.databaseSizeBytes === null ? "Unavailable" : `${formatBytes(health.databaseSizeBytes)} / ${configuredCapacityBytes ? formatBytes(configuredCapacityBytes) : "—"}`}
          detail={storagePercent === null ? "Set the applicable capacity to enable alerts" : `${storagePercent.toFixed(1)}% of ${plan === "free" ? "Free database-size allowance" : "Pro included disk reference"}`}
          tone={storageTone}
        >
          {storagePercent !== null && <div className="mt-3">
            <div className="relative h-2.5 rounded-full bg-slate-100" role="progressbar" aria-label="Database capacity percentage" aria-valuenow={Math.min(100, Math.round(storagePercent))} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${storageTone === "bad" ? "bg-red-500" : storageTone === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Math.max(0, storagePercent))}%` }} />
              <div className="absolute -top-1 h-[18px] w-[2px] bg-amber-600" style={{ left: "70%" }} title="Warn at 70%" />
              <div className="absolute -top-1 h-[18px] w-[2px] bg-red-600" style={{ left: "85%" }} title="Critical at 85%" />
            </div>
            <div className="mt-2 flex justify-between gap-2 text-[11px] font-semibold text-slate-600"><span>70% warning</span><span>85% critical</span></div>
            {plan === "pro" && <p className="mt-2 text-[11px] leading-4 text-slate-500">Included disk reference, not actual Pro disk utilization or a hard quota.</p>}
          </div>}
        </MetricCard>
        <MetricCard
          label="Database sessions"
          value={health.sessions ? `${health.sessions.total} / ${health.sessions.max}` : "Unavailable"}
          detail={health.sessions ? `${health.sessions.active} active · ${health.sessions.idle} idle` : "Session statistics unavailable"}
          tone={sessionTone}
        >
          {sessionPercent !== null && <div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, sessionPercent))}%` }} /></div>}
        </MetricCard>
        <MetricCard label="Deployment" value={commitSha} detail={`${environment} release`} tone="neutral" />
      </section>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <section aria-labelledby="tables-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4">
            <h2 id="tables-heading" className="text-base font-black tracking-tight text-slate-950">Largest database tables</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">Current table sizes, including indexes. Bars are scaled to the largest listed table.</p>
          </div>
          {legacyPercent !== null && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700">
            <strong>Legacy staging:</strong> the displayed raw_legacy_* tables account for approximately <strong>{legacyPercent.toFixed(0)}%</strong> of the current database size. Retain them until the cutover and retention runbook approves a change.
          </div>}
          {health.largestTables.length ? (
            <>
              <div className="space-y-0.5">
                {health.largestTables.map((table) => {
                  const isLegacy = table.name.startsWith("raw_legacy_");
                  return (
                    <div key={table.name} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-slate-100 py-3 last:border-b-0 sm:grid-cols-[minmax(120px,1fr)_minmax(90px,1.15fr)_auto] sm:items-center">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="break-all font-mono text-xs font-semibold text-slate-800">{table.name}</span>
                        {isLegacy && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">Legacy</span>}
                      </div>
                      <div className="col-span-2 sm:col-span-1 sm:col-start-2">
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${isLegacy ? "bg-slate-500" : "bg-blue-600"}`} style={{ width: `${Math.max(1, table.sizeBytes / maxTableBytes * 100)}%` }} />
                        </div>
                      </div>
                      <div className="col-start-2 row-start-1 whitespace-nowrap text-right text-xs font-extrabold tabular-nums text-slate-900 sm:col-start-3">{table.prettySize || formatBytes(table.sizeBytes)}</div>
                      {hasMonthlyGrowth && <div className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 sm:col-span-3">
                        {columns.map((column, index) => {
                          const current = monthSnapshots.get(column.key)?.tableSizes[table.name];
                          const previousDate = new Date();
                          previousDate.setDate(1);
                          previousDate.setMonth(previousDate.getMonth() - (columns.length - index));
                          const previous = monthSnapshots.get(monthKey(previousDate))?.tableSizes[table.name];
                          return <span key={column.key} className="inline-flex gap-1">{column.label}: <GrowthValue value={growthPercent(current, previous)} /></span>;
                        })}
                      </div>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11px] text-slate-600">
                {hasMonthlyGrowth ? <span>Rolling three-month growth shown below each table.</span> : <span>Monthly growth history is collecting; percentages will appear when comparable snapshots are available.</span>}
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-blue-600" />Application / other</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-slate-500" />Legacy staging</span>
              </div>
            </>
          ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Table-size diagnostics are unavailable for this database role.</p>}
        </section>
        <Suspense fallback={<ProtectionMonitoringFallback />}>
          <ProtectionMonitoring />
        </Suspense>
      </div>

      <section id="slow-queries" aria-labelledby="slow-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div>
            <h2 id="slow-heading" className="text-base font-black tracking-tight text-slate-950">Application query performance</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Recent observed query executions only. November 3 cutover totals do not count as current issues.
              Query origin classification is heuristic while maintenance and app connections share the same database role.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-700">{queryWindow.detail}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
              <span><strong>Last sample:</strong> {queryWindow.latestAt ? formatTimestamp(new Date(queryWindow.latestAt)) : "None"}</span>
              <span><strong>Last 24h:</strong> {queryWindow.sampleCount} samples</span>
              <span><strong>Observed span:</strong> {queryWindow.observedHours.toFixed(1)}h / 24h</span>
              {queryWindow.maximumGapMinutes !== null && <span><strong>Longest gap:</strong> {Math.round(queryWindow.maximumGapMinutes)} min</span>}
            </div>
            {queryWindow.status === "ready" && (queryWindow.observedHours < 23 || (queryWindow.maximumGapMinutes !== null && queryWindow.maximumGapMinutes > 90)) && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                Partial 24-hour coverage. Results reflect only the recorded observation period; gaps can conceal unobserved query activity.
              </p>
            )}
            {queryWindow.from && <p className="mt-1 text-xs text-slate-500">
              Observed window: {formatTimestamp(new Date(queryWindow.from))}
              {queryWindow.to ? ` → ${formatTimestamp(new Date(queryWindow.to))}` : " (baseline only)"}
            </p>}
          </div>
          {process.env.VERCEL_ENV !== "production" && (
            <form action={captureSystemHealthQuerySnapshot}>
              <button type="submit" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                Capture DEV sample
              </button>
            </form>
          )}
        </div>
        {queryWindow.status !== "ready" ? (
          <div className="mx-4 mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:mx-5">
            <span className="font-bold">{queryWindow.status === "collecting" ? "Collecting baseline" : queryWindow.status === "reset" ? "Statistics reset" : queryWindow.status === "stale" ? "Collection stale" : "Collection unavailable"}</span>
            <p className="mt-1">No current query-health conclusion is possible with missing, reset, or stale samples. A missing or stale baseline is not a green performance result.</p>
          </div>
        ) : (
          <div className="border-t border-slate-200">
            <div className="grid grid-cols-1 gap-3 bg-slate-50 px-4 py-4 sm:grid-cols-3 sm:px-5">
              <div><p className="text-xs text-slate-500">Recent slow application SQL</p><p className="text-2xl font-black tabular-nums text-slate-900">{slowAppQueries.length}</p></div>
              <div><p className="text-xs text-slate-500">Observed application calls</p><p className="text-2xl font-black tabular-nums text-slate-900">{applicationActivity.reduce((sum,q)=>sum+q.calls,0).toLocaleString()}</p></div>
              <div><p className="text-xs text-slate-500">Maintenance calls (separate)</p><p className="text-2xl font-black tabular-nums text-slate-900">{maintenanceActivity.reduce((sum,q)=>sum+q.calls,0).toLocaleString()}</p></div>
            </div>
            {slowAppQueries.length === 0 ? (
              <p className="m-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700 sm:m-5">
                No application query averaging 500 ms or more was observed between the available snapshots. This is not a full-day guarantee.
              </p>
            ) : (
              <div className="divide-y divide-slate-200">
                {slowAppQueries.slice(0, 12).map((query,index) => {
                  const action = recentQueryPriority(query);
                  const share = totalListedTime > 0 ? query.totalMs / totalListedTime * 100 : 0;
                  return <details key={index} className="group open:bg-slate-50">
                    <summary className="cursor-pointer list-none px-4 py-4 sm:px-5">
                      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-[100px_100px_80px_minmax(0,1fr)_90px] md:items-center">
                        <span className="text-xs font-black text-slate-800">{query.operation}</span>
                        <span className="text-sm font-bold tabular-nums text-slate-900">{formatDuration(query.meanMs)} avg</span>
                        <span className="text-xs tabular-nums text-slate-700">{query.calls} new calls</span>
                        <div className="col-span-2 md:col-span-1"><div className="mb-1 text-xs text-slate-700">{formatDuration(query.totalMs)} total · {share.toFixed(0)}% of listed</div>
                          <div className="h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${Math.max(1,query.totalMs/maxListedTime*100)}%`}} /></div>
                        </div>
                        <span className={`w-fit rounded-lg border px-2 py-1 text-xs font-bold ${toneClasses(action.tone)}`}>{action.label} ▾</span>
                      </div>
                    </summary>
                    <div className="px-4 pb-4 sm:px-5"><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-white">{query.sql}</pre></div>
                  </details>;
                })}
              </div>
            )}
            {maintenanceActivity.length > 0 && (
              <details className="border-t border-slate-200 px-4 py-4 sm:px-5">
                <summary className="cursor-pointer text-sm font-bold text-slate-800">Maintenance / unusual bulk activity · {maintenanceActivity.length} query patterns</summary>
                <p className="mt-2 text-xs text-amber-800">These new executions are excluded from normal performance alerts but should be reviewed if they were not planned.</p>
                {maintenanceActivity.slice(0,10).map((query,index) => <div key={index} className="mt-2 rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="font-bold">{query.operation} · {query.calls} new calls · {formatDuration(query.meanMs)} avg</div>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">{query.sql}</pre>
                </div>)}
              </details>
            )}
          </div>
        )}
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-600 sm:px-5">
          Samples may come from manual capture or the separate DEV scheduler when configured. Stale after 2½ hours; coverage gaps over 90 minutes are flagged. For SQL plans, use Supabase Query Performance.
        </div>
      </section>

      <p className="px-1 text-xs leading-5 text-slate-500">System Health is restricted to Admin access. External provider checks are isolated, cached for one to five minutes and time out after five seconds. A failed provider API cannot block Repair Orders, invoices or other shop workflows.</p>
    </div>
  );
}
