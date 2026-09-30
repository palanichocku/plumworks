import test from "node:test";
import assert from "node:assert/strict";
import { authorizedHealthRequest, healthPayload } from "../src/lib/monitoring/health.ts";
import { formatReport, measuredCheck, summarize } from "../src/lib/monitoring/report.ts";

test("health authentication fails closed and responses expose fixed fields", () => {
  assert.equal(authorizedHealthRequest("Bearer secret", undefined), false);
  assert.equal(authorizedHealthRequest("Bearer wrong", "secret"), false);
  assert.equal(authorizedHealthRequest("Bearer secret", "secret"), true);
  const failed = healthPayload(false, 42.2, 55.4, "2026-01-01T00:00:00.000Z", "local");
  assert.deepEqual(failed, { status: "failed", database: "failed", databaseMs: 42, totalMs: 55, timestamp: "2026-01-01T00:00:00.000Z", version: "local" });
  assert.equal(healthPayload(true, 1, 2, "now", "local").status, "ok");
});

test("overall classification and timing warnings", () => {
  const slow = measuredCheck("Homepage", "website", true, 11000);
  const app = measuredCheck("Dashboard", "app", true, 100);
  const database = measuredCheck("Database", "database", true, 10);
  assert.match(slow.warning, /threshold/);
  assert.equal(summarize("2026-01-01", "2026-01-02", [slow, app, database]).overall, "WARNING");
  assert.equal(summarize("2026-01-01", "2026-01-02", [measuredCheck("Homepage", "website", true, 5), app, database]).overall, "HEALTHY");
  assert.equal(summarize("2026-01-01", "2026-01-02", [measuredCheck("Homepage", "website", false, 5), app, database]).overall, "FAILED");
  assert.equal(summarize("2026-01-01", "2026-01-02", []).overall, "FAILED");
});

test("email escapes markup and uses sanitized check messages", () => {
  const result = summarize("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z", [{ ...measuredCheck("Homepage", "website", false, 10), error: "<unavailable>" }]);
  const report = formatReport(result);
  assert.match(report.text, /FAILED/);
  assert.match(report.html, /&lt;unavailable&gt;/);
  assert.doesNotMatch(report.html, /<unavailable>/);
  const devReport = formatReport(result, "DEV / Stage 1A validation");
  assert.match(devReport.subject, /DEV \/ Stage 1A validation/);
  assert.match(devReport.html, /DEV \/ Stage 1A validation/);
});
