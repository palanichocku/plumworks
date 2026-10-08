import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { measuredCheck, summarize, type Check } from "../src/lib/monitoring/report";
import { loginWithRetry, type LoginResult, type LoginAttemptTiming } from "./login";

const output = "artifacts/monitoring/result.json";
const pages = [
  ["Homepage", "/", "website"], ["Services", "/services", "website"],
  ["Appointment", "/appointment", "website"], ["Contact", "/contact", "website"],
  ["Dashboard", "/dashboard", "app"], ["Repair Orders", "/repair-orders", "app"],
  ["Invoices", "/invoices", "app"], ["Customers", "/customers", "app"],
  ["Vehicles", "/vehicles", "app"], ["Leads", "/leads", "app"],
  ["Accounts Receivable", "/accounts-receivable", "app"],
] as const;

test("read-only production health smoke", async ({ page, request }) => {
  const startedAt = new Date().toISOString();
  const checks: Check[] = [];
  let pageError = false;
  let consoleError = false;
  page.on("pageerror", () => { pageError = true; });
  page.on("console", (message) => { if (message.type() === "error") consoleError = true; });

  async function record(name: string, group: Check["group"], action: () => Promise<number | void>) {
    pageError = false;
    consoleError = false;
    const start = performance.now();
    try {
      const measured = await action();
      if (pageError) throw new Error("Page error");
      const check = measuredCheck(name, group, true, typeof measured === "number" ? measured : performance.now() - start);
      if (consoleError) check.warning = [check.warning, "Browser console error observed"].filter(Boolean).join("; ");
      checks.push(check);
    } catch {
      // Fixed diagnostics only. Browser/SQL exceptions can contain private URLs or records.
      checks.push(measuredCheck(name, group, false, performance.now() - start));
    }
  }

  try {
    const token = process.env.MONITOR_HEALTH_TOKEN;
    await record("Health endpoint", "database", async () => {
      if (!token) throw new Error("Missing token");
      const response = await request.get("/api/health", { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
      if (response.status() !== 200) throw new Error("Health status failed");
      const body = await response.json();
      if (body.status !== "ok" || body.database !== "ok") throw new Error("Database status failed");
      checks.push(measuredCheck("Database", "database", true, body.databaseMs));
      return body.totalMs;
    });
    if (!checks.some((check) => check.name === "Database")) checks.push(measuredCheck("Database", "database", false, 0));

    async function visit(name: string, path: string, group: Check["group"]) {
      await record(name, group, async () => {
        if (path === "/repair-orders" && new URL(page.url()).pathname === "/dashboard") {
          await page.locator('a[href="/repair-orders"]:visible').first().click();
          await page.waitForURL("**/repair-orders", { timeout: 30000 });
        } else {
          const response = await page.goto(path, { waitUntil: "domcontentloaded" });
          if (!response || response.status() >= 400) throw new Error("HTTP failure");
        }
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 15000 });
        if (group === "app") {
          if (new URL(page.url()).pathname === "/login") throw new Error("Login redirect");
          await page.getByRole("navigation").first().waitFor({ state: "visible", timeout: 10000 });
          if (await page.getByRole("heading", { name: /access denied|permission denied|unable to load shop access/i }).count()) throw new Error("App access failed");
        }
      });
    }

    for (const [name, path, group] of pages.slice(0, 4)) await visit(name, path, group);

    pageError = false;
    consoleError = false;
    const loginStart = performance.now();
    const email = process.env.MONITOR_USER_EMAIL;
    const password = process.env.MONITOR_USER_PASSWORD;
    const loginAttempts: LoginAttemptTiming[] = [];
    const login: LoginResult = email && password
      ? await loginWithRetry(page, email, password, { onAttempt: (timing) => loginAttempts.push(timing) })
      : { pass: false, error: "Login credentials rejected" };
    const loginCheck = measuredCheck("Login", "app", login.pass, performance.now() - loginStart);
    loginCheck.detail = loginAttempts.map(({ attempt, outcome, pageReadyMs, submitToAuthMs, authToOutcomeMs, submitToOutcomeMs }) =>
      `Attempt ${attempt} (${outcome}): page ${pageReadyMs === null ? "n/a" : Math.round(pageReadyMs) + " ms"}, submit-to-auth-response ${submitToAuthMs === null ? "n/a" : submitToAuthMs + " ms"}, auth-to-outcome ${authToOutcomeMs === null ? "n/a" : authToOutcomeMs + " ms"}, submit-to-outcome ${submitToOutcomeMs === null ? "n/a" : submitToOutcomeMs + " ms"}`
    ).join("; ") || undefined;
    if (login.pass) {
      loginCheck.warning = [loginCheck.warning, login.retried && "Login succeeded after one retry", pageError && "Browser page error observed", consoleError && "Browser console error observed"].filter(Boolean).join("; ") || undefined;
    } else {
      loginCheck.error = login.error;
    }
    checks.push(loginCheck);

    if (checks.find((check) => check.name === "Login")?.pass) {
      for (const [name, path, group] of pages.slice(4)) await visit(name, path, group);
      // Reports is read only, but only exercise it when the UI grants permission.
      if (await page.getByRole("link", { name: "Reports", exact: true }).count()) await visit("Reports", "/reports", "app");
    } else {
      for (const [name] of pages.slice(4)) checks.push(measuredCheck(name, "app", false, 0));
    }
  } finally {
    const result = summarize(startedAt, new Date().toISOString(), checks);
    await mkdir("artifacts/monitoring", { recursive: true });
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  }
  expect(checks.filter((check) => !check.pass), "Sanitized monitoring failures").toEqual([]);
});
