-- Read-only application query statistics sampling. No changes to shop tables.
CREATE TABLE "system_health_query_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  "stats_reset_at" timestamptz NOT NULL
);
CREATE INDEX "system_health_query_snapshots_captured_at_idx"
 ON "system_health_query_snapshots" ("captured_at" DESC);

CREATE TABLE "system_health_query_samples" (
  "snapshot_id" uuid NOT NULL REFERENCES "system_health_query_snapshots" ("id") ON DELETE CASCADE,
  "db_id" bigint NOT NULL,
  "user_id" bigint NOT NULL,
  "query_id" text NOT NULL,
  "operation" text NOT NULL,
  "classification" text NOT NULL,
  "calls" bigint NOT NULL,
  "total_exec_ms" double precision NOT NULL,
  PRIMARY KEY ("snapshot_id", "db_id", "user_id", "query_id")
);
CREATE INDEX "system_health_query_samples_query_idx"
 ON "system_health_query_samples" ("db_id", "user_id", "query_id");
-- Sample rows are platform operational telemetry; do not expose them to shop clients.
REVOKE ALL ON TABLE "system_health_query_snapshots", "system_health_query_samples" FROM PUBLIC, anon, authenticated;
