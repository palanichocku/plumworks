-- Batch 4 reporting-only table. No mutation of customer, lead, RO or invoice data.
CREATE TABLE IF NOT EXISTS public.marketing_performance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('GSC','GBP')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  partial boolean NOT NULL DEFAULT false,
  notes text,
  recorded_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT marketing_performance_snapshot_period CHECK (period_end >= period_start AND period_end < period_start + 367),
  CONSTRAINT marketing_performance_snapshot_identity UNIQUE(shop_id, source, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS marketing_performance_snapshots_shop_source_start_idx
  ON public.marketing_performance_snapshots (shop_id, source, period_start);
ALTER TABLE public.marketing_performance_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_performance_snapshots FROM anon, authenticated;
-- Only the server-side Prisma connection, after membership authorization, accesses this table.
