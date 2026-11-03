import { unstable_cache } from "next/cache";

export type MonitorTone = "good" | "warn" | "bad" | "neutral";

export type ExternalMonitorSummary = {
  name: string;
  tone: MonitorTone;
  value: string;
  detail: string;
  checks?: Array<{ name: string; type: string; target?: string; status: string; checkedAt?: string }>;
};

export type ResendUsageSummary = ExternalMonitorSummary & {
  dailyUsed?: number;
  dailyLimit?: number | null;
  monthlyUsed?: number;
  monthlyLimit?: number | null;
};

const EXTERNAL_TIMEOUT_MS = 2_000;
const CACHE_SECONDS = 300;

async function fetchJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function readBetterStack(): Promise<ExternalMonitorSummary> {
  const token = process.env.BETTERSTACK_API_TOKEN;
  if (!token) {
    return {
      name: "Better Stack",
      tone: "neutral",
      value: "API access not configured",
      detail: "Uptime monitoring continues independently; add a read token to surface it here.",
    };
  }

  try {
    const json = await fetchJson("https://incidents.betterstack.com/api/v2/monitors?per_page=250", {
      headers: { Authorization: `Bearer ${token}` },
    }) as {
      data?: Array<{
        attributes?: {
          status?: string;
          paused?: boolean;
          last_checked_at?: string | null;
          pronounceable_name?: string | null;
          url?: string | null;
          monitor_type?: string | null;
        };
      }>;
    };

    const monitors = Array.isArray(json.data) ? json.data : [];
    const active = monitors.filter((monitor) => !monitor.attributes?.paused);
    const down = active.filter((monitor) => monitor.attributes?.status === "down").length;
    const warning = active.filter((monitor) => ["validating", "pending"].includes(monitor.attributes?.status ?? "")).length;
    const up = active.filter((monitor) => monitor.attributes?.status === "up").length;
    const latest = active
      .map((monitor) => monitor.attributes?.last_checked_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      name: "Better Stack",
      tone: down > 0 ? "bad" : warning > 0 || up < active.length ? "warn" : active.length > 0 ? "good" : "neutral",
      value: active.length > 0 ? `${up} / ${active.length} monitors up` : "No active monitors",
      detail: `${down > 0 ? `${down} down · ` : ""}${warning > 0 ? `${warning} pending/recovering · ` : ""}${latest ? `last checked ${formatDate(latest)}` : "no recent check timestamp"}`,
      checks: active.map((monitor) => {
        const attrs = monitor.attributes;
        const type = attrs?.monitor_type ?? "monitor";
        return {
          name: attrs?.pronounceable_name?.trim() || attrs?.url?.trim() || "Unnamed monitor",
          type: type === "status" ? "HTTP uptime" : type === "expected_status_code" ? "HTTP response code" : type === "keyword" ? "Page content" : type === "playwright" ? "Browser scenario" : type,
          // Only show the hostname and path; URL querystrings can contain sensitive tokens.
          target: (() => {
            const raw = attrs?.url;
            if (!raw) return undefined;
            try { const url = new URL(raw); return url.protocol === "https:" || url.protocol === "http:" ? url.host + url.pathname : undefined; }
            catch { return undefined; }
          })(),
          status: attrs?.status === "up" ? "Passing" : attrs?.status === "down" ? "Failing" : attrs?.status ?? "Unknown",
          checkedAt: attrs?.last_checked_at ? formatDate(attrs.last_checked_at) ?? undefined : undefined,
        };
      }),
    };
  } catch {
    return {
      name: "Better Stack",
      tone: "neutral",
      value: "Status unavailable",
      detail: "The provider did not respond within the dashboard timeout. PlumWorks is unaffected.",
    };
  }
}

async function readCheckly(): Promise<ExternalMonitorSummary> {
  const apiKey = process.env.CHECKLY_API_KEY;
  const accountId = process.env.CHECKLY_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return {
      name: "Checkly",
      tone: "neutral",
      value: "API access not configured",
      detail: "Synthetic checks continue independently; add read credentials to surface them here.",
    };
  }

  try {
    const json = await fetchJson("https://api.checklyhq.com/v1/checks", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Checkly-Account": accountId,
      },
    });
    const checks = Array.isArray(json) ? json as Array<Record<string, unknown>> : [];
    const active = checks.filter((check) => check.activated !== false);
    const failed = active.filter((check) => {
      const status = typeof check.status === "string" ? check.status.toLowerCase() : "";
      return status === "failed" || status === "failing" || status === "down";
    }).length;

    return {
      name: "Checkly",
      tone: failed > 0 ? "bad" : "neutral",
      value: active.length > 0 ? `${active.length} configured active ${active.length === 1 ? "check" : "checks"}` : "No active checks",
      detail: failed > 0 ? `${failed} checks report a failure` : "Enabled checks listed below; latest run success is not verified by this API response.",
      checks: active.map((check) => ({
        name: typeof check.name === "string" && check.name.trim() ? check.name.trim() : "Unnamed check",
        type: typeof check.checkType === "string" ? check.checkType.replaceAll("_", " ") : "Synthetic check",
        target: (() => {
          const request = check.request && typeof check.request === "object" ? check.request as Record<string, unknown> : null;
          const urlValue = request?.url;
          if (typeof urlValue !== "string") return undefined;
          try { const url = new URL(urlValue); return url.protocol === "https:" || url.protocol === "http:" ? url.host + url.pathname : undefined; }
          catch { return undefined; }
        })(),
        status: typeof check.status === "string" && ["failed", "failing", "down"].includes(check.status.toLowerCase()) ? "Reported failing" : "Enabled · latest run unverified",
      })),
    };
  } catch {
    return {
      name: "Checkly",
      tone: "neutral",
      value: "Status unavailable",
      detail: "The provider did not respond within the dashboard timeout. PlumWorks is unaffected.",
    };
  }
}

async function readResend(): Promise<ResendUsageSummary> {
  const keys = [process.env.RESEND_STATUS_API_KEY, process.env.RESEND_API_KEY].filter((key): key is string => Boolean(key));
  if (keys.length === 0) {
    return {
      name: "Resend",
      tone: "neutral",
      value: "API access not configured",
      detail: "Email delivery is configured separately; usage cannot be read here yet.",
    };
  }

  for (const key of keys) {
    try {
      const json = await fetchJson("https://api.resend.com/usage", {
        headers: { Authorization: `Bearer ${key}` },
      }) as {
        emails?: {
          daily?: { used?: number; limit?: number | null };
          monthly?: { used?: number; limit?: number | null };
        };
      };
      const dailyUsed = Number(json.emails?.daily?.used ?? 0);
      const dailyLimit = json.emails?.daily?.limit ?? null;
      const monthlyUsed = Number(json.emails?.monthly?.used ?? 0);
      const monthlyLimit = json.emails?.monthly?.limit ?? null;
      const dailyPercent = dailyLimit ? dailyUsed / dailyLimit * 100 : 0;
      const monthlyPercent = monthlyLimit ? monthlyUsed / monthlyLimit * 100 : 0;
      const peak = Math.max(dailyPercent, monthlyPercent);

      return {
        name: "Resend",
        tone: peak >= 90 ? "bad" : peak >= 75 ? "warn" : "good",
        value: monthlyLimit === null ? `${monthlyUsed} this month` : `${monthlyUsed} / ${monthlyLimit} this month`,
        detail: dailyLimit === null ? `${dailyUsed} used today` : `${dailyUsed} / ${dailyLimit} today`,
        dailyUsed,
        dailyLimit,
        monthlyUsed,
        monthlyLimit,
      };
    } catch {
      // Try the next server-side key. Never expose keys or provider errors to the UI.
    }
  }

  return {
    name: "Resend",
    tone: "neutral",
    value: "Usage unavailable",
    detail: "The Usage API could not be read within the dashboard timeout. Email sending is unaffected.",
  };
}

const cachedBetterStack = unstable_cache(readBetterStack, ["system-health-better-stack-detail-v4"], { revalidate: CACHE_SECONDS });
const cachedCheckly = unstable_cache(readCheckly, ["system-health-checkly-detail-v4"], { revalidate: CACHE_SECONDS });
const cachedResend = unstable_cache(readResend, ["system-health-resend"], { revalidate: CACHE_SECONDS });

export async function getExternalHealth() {
  const [betterStack, checkly, resend] = await Promise.all([
    cachedBetterStack(),
    cachedCheckly(),
    cachedResend(),
  ]);

  return { betterStack, checkly, resend };
}


async function readBackup(): Promise<ExternalMonitorSummary> {
  // On Free, Supabase does not provide managed automatic database backups.
  const plan = process.env.SYSTEM_HEALTH_SUPABASE_PLAN === "pro"
    ? "pro"
    : process.env.SYSTEM_HEALTH_SUPABASE_PLAN === "free"
      ? "free"
      : process.env.VERCEL_ENV === "production" ? "pro" : "free";
  if (plan === "free") {
    return {
      name: "Backup",
      tone: "neutral",
      value: "Not included on Free",
      detail: "Automatic Supabase backups are a paid-plan feature. This is expected for DEV.",
    };
  }

  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const ref = process.env.SYSTEM_HEALTH_SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    return {
      name: "Backup",
      tone: "neutral",
      value: "API access not configured",
      detail: "Add a Supabase fine-grained backups_read token and project ref to see actual Pro backups.",
    };
  }

  try {
    const payload = await fetchJson(
      `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/backups`,
      { headers: { Authorization: `Bearer ${token}` } },
    ) as {
      backups?: Array<{ status?: string; inserted_at?: string | null }>;
      pitr_enabled?: boolean;
      physical_backup_data?: { latest_physical_backup_date_unix?: number | null };
    };

    const completed = (payload.backups ?? [])
      .filter((backup) => backup.status?.toUpperCase() === "COMPLETED" && backup.inserted_at)
      .map((backup) => new Date(backup.inserted_at!))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());
    const physicalUnix = payload.physical_backup_data?.latest_physical_backup_date_unix;
    if (typeof physicalUnix === "number" && Number.isFinite(physicalUnix) && physicalUnix > 0) {
      completed.push(new Date(physicalUnix * 1000));
      completed.sort((a, b) => b.getTime() - a.getTime());
    }
    const latest = completed[0];
    if (!latest) {
      return {
        name: "Backup",
        tone: "warn",
        value: "No completed backup reported",
        detail: payload.pitr_enabled
          ? "PITR is enabled; no completed backup timestamp returned by this endpoint."
          : "Check Supabase backup settings and project status.",
      };
    }
    const hours = Math.max(0, (Date.now() - latest.getTime()) / 3_600_000);
    return {
      name: "Backup",
      tone: hours >= 48 ? "bad" : hours >= 30 ? "warn" : "good",
      value: `Last backup ${formatDate(latest.toISOString()) ?? "available"}`,
      detail: `${Math.round(hours)} hours ago${payload.pitr_enabled ? " · PITR enabled" : ""}`,
    };
  } catch {
    return {
      name: "Backup",
      tone: "neutral",
      value: "Status unavailable",
      detail: "Supabase backup status could not be retrieved. App operation is unaffected.",
    };
  }
}
const cachedBackup = unstable_cache(readBackup, ["system-health-supabase-backup-v3"], { revalidate: CACHE_SECONDS });
export async function getBackupHealth() {
  return cachedBackup();
}
