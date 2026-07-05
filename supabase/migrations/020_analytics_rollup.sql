-- Task 8.1: pre-aggregated daily analytics rollups.
--
-- `analytics_daily` holds one row per (client_id, day, path) with `views`
-- (count of `page_view` events for that grouping) and `visitors` (count of
-- DISTINCT `visitor_id` for that same grouping — a visitor who views the
-- same path twice in a day counts once, unlike `views`). Refreshed by the
-- `/api/cron/rollup-analytics` cron (see that route for the exact
-- aggregation window/logic) so the dashboard's 30/90-day views never have
-- to scan raw `analytics_events` rows.
--
-- Deliberately kept to exactly day/path/views/visitors, per the brief: only
-- "Top Pages" and the page-view trend chart read from this table.
-- Referrer/device/browser/country/custom-event breakdowns still need raw
-- events and are NOT aggregated here — expanding this schema to capture
-- every raw-event dimension would meaningfully increase cron/schema
-- complexity for what was scoped as a simple rollup; the analytics
-- dashboard instead shows those cards scoped to the last 7 days regardless
-- of the selected range, with a note to that effect.
CREATE TABLE IF NOT EXISTS public.analytics_daily (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  day         DATE NOT NULL,
  path        TEXT NOT NULL,
  views       INT NOT NULL DEFAULT 0,
  visitors    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, day, path)
);

-- Dashboard queries filter by client_id and a day range, then sort/group by
-- path — this index covers the client_id + day (DESC, for "most recent
-- first") access pattern; path lookups within a client/day are cheap once
-- narrowed to a handful of rows.
CREATE INDEX IF NOT EXISTS analytics_daily_client_day_idx
  ON public.analytics_daily (client_id, day DESC);

-- Reuses the same `handle_updated_at()` trigger function every other
-- updated_at-bearing table in this schema uses (migration 001).
CREATE OR REPLACE TRIGGER analytics_daily_updated_at
  BEFORE UPDATE ON public.analytics_daily
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;

-- Broad authenticated read (own client, or all clients for ne_admin) —
-- matches the Phase 5 posture rule for observability/operational data that
-- isn't schema-sensitive, and mirrors `webhook_deliveries`' own SELECT
-- policy (migration 017) exactly. Deliberately NO anon/public read: unlike
-- `analytics_events` (which needs public INSERT from client-site trackers
-- and public-adjacent read patterns are irrelevant there), this rollup is
-- never consumed by client sites — only the CMS dashboard reads it.
CREATE POLICY "analytics_daily_select" ON public.analytics_daily
  FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated at all. Only the
-- rollup cron's service-role admin client (`createAdminClient()`, bypasses
-- RLS) ever writes this table — the same write-only-via-service-role shape
-- `webhook_deliveries` established in Task 7.1. A regular CMS session
-- should never be able to write rollup rows directly.
