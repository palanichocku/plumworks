import test from "node:test";
import assert from "node:assert/strict";
import { loginWithRetry } from "../monitoring/login.ts";
import { formatReport, measuredCheck, summarize } from "../src/lib/monitoring/report.ts";

const email = "monitor@example.invalid";
const password = "private-password";
const options = { outcomeTimeoutMs: 5, retryDelayMs: 0, pollIntervalMs: 1 };

function fakeLoginPage(outcomes, { authDelayMs = 0, dashboardDelayMs = 0 } = {}) {
  let attempt = -1;
  let clicked = false;
  const visits = [];
  const fills = [];
  const listeners = new Set();
  const page = {
    visits,
    fills,
    on: (event, listener) => { if (event === "response") listeners.add(listener); },
    off: (event, listener) => { if (event === "response") listeners.delete(listener); },
    goto: async (path) => { visits.push(path); attempt++; clicked = false; },
    url: () => clicked && ["success", "dashboard-no-heading"].includes(outcomes[attempt]) ? "https://example.invalid/dashboard" : "https://example.invalid/login",
    locator: (selector) => ({ fill: async (value) => { fills.push([attempt, selector, value]); } }),
    getByRole: (role, args) => {
      if (role === "button") return { click: async () => {
        clicked = true;
        if (authDelayMs) await new Promise((resolve) => setTimeout(resolve, authDelayMs));
        if (outcomes[attempt] === "success" || outcomes[attempt] === "dashboard-no-heading") {
          for (const listener of listeners) listener({ url: () => "https://example.invalid/auth/v1/token?grant_type=password", request: () => ({ method: () => "POST" }) });
        }
        if (outcomes[attempt] === "exception") throw new Error(`raw Supabase error token=${password} authorization=${email}`);
      } };
      if (role === "heading") return { isVisible: async () => { if (dashboardDelayMs) await new Promise((resolve) => setTimeout(resolve, dashboardDelayMs)); return clicked && outcomes[attempt] === "success" && args.name === "Dashboard"; } };
      if (role === "alert") return { filter: ({ hasText }) => ({ isVisible: async () => clicked && (
        outcomes[attempt] === "credentials" && hasText === "Invalid email or password." ||
        outcomes[attempt] === "service" && hasText === "Unable to sign in right now. Please try again."
      ) }) };
      throw new Error("Unexpected role");
    },
  };
  return page;
}

test("first-attempt UI success needs the dashboard heading and does not retry", async () => {
  const page = fakeLoginPage(["success"]);
  assert.deepEqual(await loginWithRetry(page, email, password, options), { pass: true, retried: false });
  assert.deepEqual(page.visits, ["/login"]);
});

test("transient service failure retries from a fresh login page and reports WARNING on success", async () => {
  const page = fakeLoginPage(["service", "success"]);
  const start = performance.now();
  const login = await loginWithRetry(page, email, password, options);
  const check = measuredCheck("Login", "app", login.pass, performance.now() - start);
  if (login.pass && login.retried) check.warning = "Login succeeded after one retry";
  const report = summarize("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z", [
    measuredCheck("Homepage", "website", true, 1), measuredCheck("Database", "database", true, 1), check,
  ]);
  assert.deepEqual(page.visits, ["/login", "/login"]);
  assert.equal(page.fills.length, 4);
  assert.deepEqual(login, { pass: true, retried: true });
  assert.equal(report.overall, "WARNING");
  assert.match(formatReport(report).text, /Login succeeded after one retry/);
});

test("credential rejection is immediate and does not retry", async () => {
  const page = fakeLoginPage(["credentials", "success"]);
  assert.deepEqual(await loginWithRetry(page, email, password, options), { pass: false, error: "Login credentials rejected" });
  assert.deepEqual(page.visits, ["/login"]);
});

test("service failure twice remains a fixed failure", async () => {
  const page = fakeLoginPage(["service", "service"]);
  assert.deepEqual(await loginWithRetry(page, email, password, options), { pass: false, error: "Authentication service unavailable after retry" });
  assert.equal(page.visits.length, 2);
});

test("unresolved navigation twice remains a fixed failure", async () => {
  const page = fakeLoginPage(["timeout", "timeout"]);
  assert.deepEqual(await loginWithRetry(page, email, password, options), { pass: false, error: "Login navigation timed out after retry" });
  assert.equal(page.visits.length, 2);
});

test("dashboard URL alone does not count as a successful login", async () => {
  const page = fakeLoginPage(["dashboard-no-heading", "dashboard-no-heading"]);
  assert.deepEqual(await loginWithRetry(page, email, password, options), { pass: false, error: "Login navigation timed out after retry" });
  assert.equal(page.visits.length, 2);
});

test("serialized diagnostics exclude credentials, tokens, and raw browser errors", async () => {
  const page = fakeLoginPage(["exception", "exception"]);
  const login = await loginWithRetry(page, email, password, options);
  const check = { ...measuredCheck("Login", "app", false, 10), error: login.error };
  const result = summarize("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z", [check]);
  const diagnostics = JSON.stringify(result) + formatReport(result).text + formatReport(result).html;
  assert.equal(login.error, "Login navigation timed out after retry");
  assert.doesNotMatch(diagnostics, /monitor@example\.invalid|private-password|raw Supabase error|authorization=|token=/);
});

test("phase timings distinguish auth response from dashboard readiness without exposing request details", async () => {
  const page = fakeLoginPage(["success"], { authDelayMs: 12, dashboardDelayMs: 12 });
  const attempts = [];
  const login = await loginWithRetry(page, email, password, { ...options, onAttempt: (timing) => attempts.push(timing) });
  assert.equal(login.pass, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attempt, 1);
  assert.equal(attempts[0].outcome, "success");
  assert.ok(attempts[0].submitToAuthMs >= 10);
  assert.ok(attempts[0].authToOutcomeMs >= 10);
  assert.ok(attempts[0].pageReadyMs >= 0);
  const check = { ...measuredCheck("Login", "app", true, 30), detail: `Attempt ${attempts[0].attempt}: submit-to-auth-response ${attempts[0].submitToAuthMs} ms` };
  const report = summarize("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z", [measuredCheck("Homepage", "website", true, 1), measuredCheck("Database", "database", true, 1), check]);
  assert.equal(report.overall, "HEALTHY");
  assert.match(formatReport(report).text, /submit-to-auth-response/);
  assert.doesNotMatch(JSON.stringify(attempts) + formatReport(report).text, /monitor@example\.invalid|private-password|example\.invalid|token\?grant_type/);
});
