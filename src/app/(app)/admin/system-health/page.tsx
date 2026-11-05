import { Suspense, type ReactNode } from "react";
import { PageHeading } from "@/components/page-heading";
import { prisma } from "@/lib/prisma";
import { getExternalHealth, getBackupHealth, type MonitorTone } from "@/lib/system-health/external";
import { getRecentQueryPerformance } from "@/lib/system-health/query-performance";
import { QueryPerformanceCard } from "./query-performance-card";

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

function formatTableMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
  const passing = cards.filter((card) => card.tone === "good").length;
  const failing = cards.filter((card) => card.tone === "bad").length;
  return (
    <section id="monitoring" aria-labelledby="monitor-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="monitor-heading" className="text-base font-black tracking-tight text-slate-950">Protection & monitoring</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">Latest provider results · cached 1–5 minutes · isolated from shop workflows</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">{passing} passing</span>
          {failing > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-800">{failing} failing</span>}
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">{cards.length - passing - failing} other / unavailable</span>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-2">
        {cards.map((card) => {
          const expanded = card.name === "Better Stack" || card.name === "Checkly";
          return (
            <details key={card.name} open={expanded ? true : undefined} className="group min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white open:border-slate-300">
              <summary className="flex min-h-16 cursor-pointer list-none items-start justify-between gap-2 p-3.5 marker:hidden [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-extrabold text-slate-950">{card.name}</h3>
                  <p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-700">{card.value}</p>
                  {!expanded && <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{card.detail}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold ${toneClasses(card.tone)}`}>
                    <StatusDot tone={card.tone} />{statusNames[card.tone]}
                  </span>
                  <svg aria-hidden="true" className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </summary>
              <div className="space-y-2 border-t border-slate-100 px-3.5 pb-3.5 pt-2.5">
                <p className="text-[11px] leading-4 text-slate-500">{card.detail}</p>
                {card.checks && card.checks.length > 0 ? card.checks.map((check, index) => (
                  <div key={index} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words font-bold text-slate-800">{check.name}</span>
                      <span className="shrink-0 font-semibold text-slate-700">{check.status}</span>
                    </div>
                    <p className="mt-1 break-all text-[11px] leading-4 text-slate-600">{check.type}{check.target ? ` · ${check.target}` : ""}</p>
                    {check.checkedAt && <p className="mt-0.5 text-[11px] text-slate-500">{card.name === "Checkly" ? "Status updated" : "Checked"}: {check.checkedAt}</p>}
                  </div>
                )) : <p className="text-[11px] text-slate-500">No individual checks are available for this provider.</p>}
              </div>
            </details>
          );
        })}
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


  const actionableQueries = queryWindow.status === "ready"
    ? queryWindow.queries.filter((query) => query.classification === "application" && query.meanMs >= 500)
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

      <Suspense fallback={<ProtectionMonitoringFallback />}>
        <ProtectionMonitoring />
      </Suspense>

      <section aria-labelledby="tables-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="tables-heading" className="text-base font-black tracking-tight text-slate-950">Largest database tables</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">Current table sizes, including indexes. Bars are relative to the largest listed table.</p>
              {!hasMonthlyGrowth && <p className="mt-1 text-[11px] text-slate-500" title="Growth requires comparable monthly snapshots; no values are estimated.">ⓘ Monthly growth: collecting history</p>}
            </div>
            <div aria-label="Table categories" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Application / other</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-500" />Legacy staging</span>
            </div>
          </div>
          {legacyPercent !== null && <div role="note" className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-950">
            <span aria-hidden="true" className="mt-0.5 text-amber-700">⚠</span>
            <p><strong>Legacy data footprint:</strong> Listed <code className="font-mono">raw_legacy_*</code> tables occupy <strong>~{legacyPercent.toFixed(0)}%</strong> of the current database size. Do not delete until the cutover and retention runbook authorizes cleanup.</p>
          </div>}
          {health.largestTables.length ? (
            <>
              <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(100px,1fr)_80px_64px] items-center gap-3 border-b border-slate-200 pb-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 sm:grid">
                <span>Table name</span><span>Size allocation</span><span className="text-right">Total size</span><span className="text-right" title="Share of entire database, not just the ten tables shown">% of DB</span>
              </div>
              <div className="divide-y divide-slate-200">
                {health.largestTables.map((table) => {
                  const isLegacy = table.name.startsWith("raw_legacy_");
                  const databaseShare = health.databaseSizeBytes && health.databaseSizeBytes > 0
                    ? table.sizeBytes / health.databaseSizeBytes * 100 : null;
                  return (
                    <div key={table.name} className="min-w-0 py-3">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(100px,1fr)_80px_64px]">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="min-w-0 break-all font-mono text-xs font-semibold text-slate-900">{table.name}</span>
                          {isLegacy && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">Legacy</span>}
                        </div>
                        <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                          <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                            <div className={`h-full rounded-full ${isLegacy ? "bg-slate-500" : "bg-blue-600"}`} style={{ width: `${Math.max(1, table.sizeBytes / maxTableBytes * 100)}%` }} />
                          </div>
                        </div>
                        <div className="col-start-2 row-start-1 whitespace-nowrap text-right text-xs font-extrabold tabular-nums text-slate-950 sm:col-start-3">{formatTableMB(table.sizeBytes)}</div>
                        <div className="col-span-2 row-start-3 text-right text-[11px] font-bold tabular-nums text-slate-600 sm:col-span-1 sm:col-start-4 sm:row-start-1">
                          {databaseShare === null ? "—" : databaseShare.toFixed(1) + "%"}
                          <span className="ml-1 font-normal sm:hidden">of DB</span>
                        </div>
                      </div>
                      {hasMonthlyGrowth && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                        <span className="font-bold text-slate-500">Monthly growth:</span>
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
              <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-500">
                {hasMonthlyGrowth ? "Monthly growth uses actual snapshots; missing months show —." : "Monthly growth appears after comparable snapshots become available."}
                {" "}All sizes use MB (1 MB = 1,048,576 bytes). Percentages compare each table to the entire current database, not only these ten tables.
              </p>
            </>
          ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Table-size diagnostics are unavailable for this database role.</p>}
        </section>

      <QueryPerformanceCard
        window={queryWindow}
        nowIso={updatedAt.toISOString()}
        allowCapture={process.env.VERCEL_ENV !== "production"}
        supabaseUrl="https://supabase.com/dashboard/projects"
      />

      <p className="px-1 text-xs leading-5 text-slate-500">System Health is restricted to Admin access. External provider checks are isolated, cached for one to five minutes and time out after five seconds. A failed provider API cannot block Repair Orders, invoices or other shop workflows.</p>
    </div>
  );
}
