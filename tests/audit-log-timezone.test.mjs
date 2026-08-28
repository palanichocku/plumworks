import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatAuditLogTimestamp } from "../src/lib/audit-log-formatters.ts";

test("Audit Log converts summer UTC timestamps to Detroit daylight time", () => {
  assert.equal(
    formatAuditLogTimestamp(new Date("2026-08-28T14:04:02Z")),
    "8/28/2026, 10:04:02 AM",
  );
});

test("Audit Log converts winter UTC timestamps to Detroit standard time", () => {
  assert.equal(
    formatAuditLogTimestamp(new Date("2026-01-15T15:04:02Z")),
    "1/15/2026, 10:04:02 AM",
  );
});

test("Audit Log page uses the Detroit formatter without changing query filters or ordering", async () => {
  const [page, formatter] = await Promise.all([
    readFile(new URL("../src/app/(app)/admin/audit-log/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/audit-log-formatters.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /formatAuditLogTimestamp\(event\.createdAt\)/);
  assert.match(page, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(page, /take: 100/);
  assert.match(formatter, /timeZone: "America\/Detroit"/);
  assert.doesNotMatch(formatter, /setHours|setUTCHours|UTC-?4|UTC-?5|EST|EDT/);
});
