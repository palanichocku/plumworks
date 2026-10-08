export type Check = { name: string; group: "website" | "app" | "database"; pass: boolean; elapsedMs: number; warning?: string; error?: string; detail?: string };
export type MonitoringResult = { startedAt: string; endedAt: string; totalMs: number; overall: "HEALTHY" | "WARNING" | "FAILED"; website: "OK" | "FAILED"; app: "OK" | "FAILED"; database: "OK" | "FAILED"; checks: Check[] };

export const thresholdsMs: Record<string, number> = {
  Homepage: 10000, "Health endpoint": 10000, Database: 5000, Login: 15000,
  Dashboard: 15000, "Repair Orders": 15000, Invoices: 15000, Customers: 15000, Vehicles: 15000,
};

export function summarize(startedAt: string, endedAt: string, checks: Check[]): MonitoringResult {
  const groups = (group: Check["group"]) => checks.some((check) => check.group === group) && checks.filter((check) => check.group === group).every((check) => check.pass) ? "OK" : "FAILED";
  const website = groups("website");
  const app = groups("app");
  const database = groups("database");
  return {
    startedAt, endedAt, totalMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    overall: website === "FAILED" || app === "FAILED" || database === "FAILED" ? "FAILED" : checks.some((check) => check.warning) ? "WARNING" : "HEALTHY",
    website, app, database, checks,
  };
}

export function measuredCheck(name: string, group: Check["group"], pass: boolean, elapsedMs: number): Check {
  const ms = Math.max(0, Math.round(elapsedMs));
  return { name, group, pass, elapsedMs: ms,
    ...(!pass ? { error: `${name} did not load successfully` } : {}),
    ...(pass && thresholdsMs[name] && ms > thresholdsMs[name] ? { warning: `${name} exceeded the ${thresholdsMs[name]} ms warning threshold` } : {}),
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

export function formatReport(result: MonitoringResult, label: "Production" | "DEV / Stage 1A validation" = "Production") {
  const date = result.startedAt.slice(0, 10);
  const passed = result.checks.filter((check) => check.pass).length;
  const issues = result.checks.flatMap((check) => [check.error, check.warning].filter((item): item is string => Boolean(item)));
  const lines = [
    `Car Doc ${label} Health — ${date}`, "", `Overall Status: ${result.overall}`, "",
    `Car Doc Website status: ${result.website}`, `PlumWorks App status: ${result.app}`, `Database status: ${result.database}`, "",
    `Functional tests: ${passed}/${result.checks.length} passed`, "", "Response times:",
    ...result.checks.flatMap((check) => [`${check.name}: ${check.elapsedMs} ms`, ...(check.detail ? [`  ${check.detail}`] : [])]), "", "Issues / Warnings:",
    ...(issues.length ? issues.map((item) => `- ${item}`) : ["None"]),
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;line-height:1.5"><h1>Car Doc ${escapeHtml(label)} Health — ${escapeHtml(date)}</h1><pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(lines.slice(2).join("\n"))}</pre></div>`;
  return { subject: `Car Doc ${label} Health — ${date} — ${result.overall}`, text, html };
}
