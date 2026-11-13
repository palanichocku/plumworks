import "server-only";
import { createSign } from "node:crypto";

type Credentials = { client_email: string; private_key: string; token_uri?: string };
type Ga4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type Ga4Response = { rows?: Ga4Row[]; rowCount?: number };
export type Ga4Breakdown = { name: string; value: number };
export type Ga4VisitorReport = {
  state: "not_configured" | "available" | "unavailable";
  month: string;
  visitors: number | null;
  sessions: number | null;
  engagedSessions: number | null;
  pageViews: number | null;
  channels: Ga4Breakdown[];
  pages: Ga4Breakdown[];
};

export function lastCompleteGa4Month(now = new Date()): { month: string; start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { month: start.toISOString().slice(0, 7), start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
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
  const range = lastCompleteGa4Month(now);
  const result: Ga4VisitorReport = {
    state: "not_configured", month: range.month, visitors: null, sessions: null,
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
      state: row ? "available" : "unavailable", month: range.month,
      visitors: parseCount(row?.metricValues?.[0]?.value),
      sessions: parseCount(row?.metricValues?.[1]?.value),
      engagedSessions: parseCount(row?.metricValues?.[2]?.value),
      pageViews: parseCount(row?.metricValues?.[3]?.value),
      channels: breakdown(channels), pages: breakdown(pages),
    };
  } catch {
    // Do not show private service account details or misleading zero traffic.
    return { ...result, state: "unavailable" };
  }
}
