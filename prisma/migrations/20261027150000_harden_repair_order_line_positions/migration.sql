-- This migration was created after the original application-table hardening
-- migration. Keep this migration-managed table server-only like the rest.
ALTER TABLE public.repair_order_line_positions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.repair_order_line_positions
FROM PUBLIC, anon, authenticated;
