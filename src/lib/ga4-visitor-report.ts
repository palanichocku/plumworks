import "server-only";
import { createSign } from "node:crypto";

type Credentials = { client_email: string; private_key: string; token_uri?: string };
type Ga4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type Ga4Response = { rows?: Ga4Row[]; rowCount?: number };
export type Ga4Breakdown = { name: string; value: number };
export type Ga4VisitorReport = {
  state: "not_configured" | "available" | "no_data" | "connection_error";
  partial: boolean;
  month: string;
  visitors: number | null;
  sessions: number | null;
  engagedSessions: number | null;
  pageViews: number | null;
  channels: Ga4Breakdown[];
  pages: Ga4Breakdown[];
};

// Track activity in the initial partial reporting month (GA4 went live Nov 2026).
// From December onward, switch to the latest complete calendar month automatically.
// All date boundaries are based on Car Doc's reporting timezone, not the server's UTC month.
export function ga4ReportingRange(now = new Date()): { month: string; start: string; end: string; partial: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = `${byType.year}-${byType.month}-${byType.day}`;
  const currentMonth = today.slice(0, 7);
  if (currentMonth === "2026-11") {
    return { month: currentMonth, start: "2026-11-01", end: today, partial: true };
  }
  const firstOfCurrentMonth = new Date(`${currentMonth}-01T00:00:00Z`);
  const previousDay = new Date(firstOfCurrentMonth.getTime() - 86400000).toISOString().slice(0, 10);
  return { month: previousDay.slice(0, 7), start: previousDay.slice(0, 7) + "-01", end: previousDay, partial: false };
}
function parseCount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}
function readCredentials(json: string): Credentials {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid service account.");
  const obj = value as Record<string, unknown>;
  if (typeof obj.client_email !== "string" || !obj.client_email.endsWith(".gserviceaccount.com") ||
      typeof obj.private_key !== "string" || !obj.private_key.includes("BEGIN PRIVATE KEY")) throw new Error("Invalid service account.");
  return { client_email: obj.client_email, private_key: obj.private_key };
}
async function accessToken(credentials: Credentials): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claim = { iss: credentials.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 1800 };
  const unsigned = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + base64url(JSON.stringify(claim));
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + base64url(signer.sign(credentials.private_key));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(9000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("GA4 authentication failed.");
  const token: unknown = await response.json();
  const access = (token as { access_token?: unknown }).access_token;
  if (typeof access !== "string" || !access) throw new Error("GA4 authentication returned no access token.");
  return access;
}
async function runReport(token: string, property: string, start: string, end: string, metrics: string[], dimension?: string): Promise<Ga4Response> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(9000),
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      metrics: metrics.map((name) => ({ name })),
      ...(dimension ? { dimensions: [{ name: dimension }], orderBys: [{ metric: { metricName: metrics[0] }, desc: true }], limit: "5" } : {}),
    }),
  });
  if (!response.ok) throw new Error("GA4 Data API request failed.");
  return await response.json() as Ga4Response;
}
function breakdown(report: Ga4Response): Ga4Breakdown[] {
  return (report.rows ?? []).flatMap((row) => {
    const name = row.dimensionValues?.[0]?.value ?? "";
    const count = parseCount(row.metricValues?.[0]?.value);
    return name && count !== null ? [{ name: name.slice(0, 90), value: count }] : [];
  });
}
export async function getGa4VisitorReport(now = new Date()): Promise<Ga4VisitorReport> {
  const range = ga4ReportingRange(now);
  const result: Ga4VisitorReport = {
    state: "not_configured", month: range.month, partial: range.partial, visitors: null, sessions: null,
    engagedSessions: null, pageViews: null, channels: [], pages: [],
  };
  const property = process.env.GA4_PROPERTY_ID?.trim();
  const rawCredentials = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!property || !/^\d{5,18}$/.test(property) || !rawCredentials) return result;
  try {
    const token = await accessToken(readCredentials(rawCredentials));
    const [totals, channels, pages] = await Promise.all([
      runReport(token, property, range.start, range.end, ["activeUsers", "sessions", "engagedSessions", "screenPageViews"]),
      runReport(token, property, range.start, range.end, ["sessions"], "sessionDefaultChannelGroup"),
      runReport(token, property, range.start, range.end, ["screenPageViews"], "pagePath"),
    ]);
    const row = totals.rows?.[0];
    return {
      state: row ? "available" : "no_data", month: range.month, partial: range.partial,
      visitors: parseCount(row?.metricValues?.[0]?.value),
      sessions: parseCount(row?.metricValues?.[1]?.value),
      engagedSessions: parseCount(row?.metricValues?.[2]?.value),
      pageViews: parseCount(row?.metricValues?.[3]?.value),
      channels: breakdown(channels), pages: breakdown(pages),
    };
  } catch (error) {
    // Only a non-sensitive error category is logged; never expose credentials, tokens, or API bodies.
    const category = error instanceof Error && /authentication/i.test(error.message) ? "authentication" : "reporting";
    console.error(`[GA4] Read-only report failed (${category}).`);
    return { ...result, state: "connection_error" };
  }
}

export type Ga4RecentVisitors = {
  realtime: { state: "available" | "not_configured" | "connection_error"; activeUsers: number | null; pageViews: number | null };
  hourly: { state: "available" | "no_data" | "not_configured" | "connection_error"; sessions: number | null; pageViews: number | null };
  refreshedAt: string;
};

// Realtime is restricted by Google to the last 30 minutes for standard GA4 properties.
// The 24-hour view below uses processed hourly buckets; it is NOT realtime.
async function realtimeReport(token: string, property: string): Promise<Ga4Response> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runRealtimeReport`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(9000),
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }] }),
  });
  if (!response.ok) throw new Error("GA4 realtime reporting failed.");
  return await response.json() as Ga4Response;
}

function detroitHour(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const partsByType = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${partsByType.year}${partsByType.month}${partsByType.day}${partsByType.hour}`;
}

export function recentHourlyWindow(now = new Date()) {
  // Inclusive hour boundaries: the current hour plus the previous 23 hourly buckets.
  return { first: detroitHour(new Date(now.getTime() - 23 * 3600000)), last: detroitHour(now) };
}

async function hourlyReport(token: string, property: string, now: Date): Promise<Ga4Response> {
  const yesterday = new Date(now.getTime() - 48 * 3600000);
  const start = detroitHour(yesterday).slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const end = detroitHour(now).slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(9000),
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "dateHour" }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
      limit: "100",
    }),
  });
  if (!response.ok) throw new Error("GA4 hourly reporting failed.");
  return await response.json() as Ga4Response;
}

export async function getGa4RecentVisitors(now = new Date()): Promise<Ga4RecentVisitors> {
  const initial: Ga4RecentVisitors = {
    refreshedAt: now.toISOString(),
    realtime: { state: "not_configured", activeUsers: null, pageViews: null },
    hourly: { state: "not_configured", sessions: null, pageViews: null },
  };
  const property = process.env.GA4_PROPERTY_ID?.trim();
  const rawCredentials = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!property || !/^\d{5,18}$/.test(property) || !rawCredentials) return initial;
  let token: string;
  try {
    token = await accessToken(readCredentials(rawCredentials));
  } catch {
    console.error("[GA4] Recent reporting authentication failed.");
    return {
      ...initial,
      realtime: { ...initial.realtime, state: "connection_error" },
      hourly: { ...initial.hourly, state: "connection_error" },
    };
  }
  const [live, hourly] = await Promise.allSettled([realtimeReport(token, property), hourlyReport(token, property, now)]);
  const realtime: Ga4RecentVisitors["realtime"] = live.status === "fulfilled"
    ? { state: "available", activeUsers: parseCount(live.value.rows?.[0]?.metricValues?.[0]?.value) ?? 0,
        pageViews: parseCount(live.value.rows?.[0]?.metricValues?.[1]?.value) ?? 0 }
    : { state: "connection_error", activeUsers: null, pageViews: null };
  const window = recentHourlyWindow(now);
  const rows = hourly.status === "fulfilled"
    ? (hourly.value.rows ?? []).filter((row) => {
      const hour = row.dimensionValues?.[0]?.value ?? "";
      return /^\d{10}$/.test(hour) && hour >= window.first && hour <= window.last;
    }) : [];
  const hourlySummary: Ga4RecentVisitors["hourly"] = hourly.status === "rejected"
    ? { state: "connection_error", sessions: null, pageViews: null }
    : rows.length === 0
      ? { state: "no_data", sessions: null, pageViews: null }
      : {
        state: "available",
        sessions: rows.reduce((sum, row) => sum + (parseCount(row.metricValues?.[0]?.value) ?? 0), 0),
        pageViews: rows.reduce((sum, row) => sum + (parseCount(row.metricValues?.[1]?.value) ?? 0), 0),
      };
  if (live.status === "rejected") console.error("[GA4] Realtime reporting failed.");
  if (hourly.status === "rejected") console.error("[GA4] Processed hourly reporting failed.");
  return { refreshedAt: now.toISOString(), realtime, hourly: hourlySummary };
}
