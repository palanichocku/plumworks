import { unstable_cache } from "next/cache";

export type MonitorTone = "good" | "warn" | "bad" | "neutral";

export type ExternalMonitorSummary = {
  name: string;
  tone: MonitorTone;
  value: string;
  detail: string;
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
      tone: down > 0 ? "bad" : warning > 0 ? "warn" : active.length > 0 ? "good" : "neutral",
      value: active.length > 0 ? `${up} / ${active.length} monitors up` : "No active monitors",
      detail: `${down > 0 ? `${down} down · ` : ""}${warning > 0 ? `${warning} pending/recovering · ` : ""}${latest ? `last checked ${formatDate(latest)}` : "no recent check timestamp"}`,
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
      tone: failed > 0 ? "bad" : active.length > 0 ? "good" : "neutral",
      value: active.length > 0 ? `${active.length} active checks` : "No active checks",
      detail: failed > 0 ? `${failed} checks report a failure` : "Synthetic monitoring configuration is active.",
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

const cachedBetterStack = unstable_cache(readBetterStack, ["system-health-better-stack"], { revalidate: CACHE_SECONDS });
const cachedCheckly = unstable_cache(readCheckly, ["system-health-checkly"], { revalidate: CACHE_SECONDS });
const cachedResend = unstable_cache(readResend, ["system-health-resend"], { revalidate: CACHE_SECONDS });

export async function getExternalHealth() {
  const [betterStack, checkly, resend] = await Promise.all([
    cachedBetterStack(),
    cachedCheckly(),
    cachedResend(),
  ]);

  return { betterStack, checkly, resend };
}
