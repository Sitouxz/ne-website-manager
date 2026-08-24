-- `analytics_events` is defined in 001_initial_schema and that migration is
-- recorded as applied, but the table was absent from the production database
-- — it had been dropped at some point. Every beacon POST to
-- /api/client/{slug}/analytics was therefore failing with a 500, which is why
-- the Analytics screen showed zeroes for every client.
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  event_name  TEXT NOT NULL DEFAULT 'page_view',
  path        TEXT NOT NULL DEFAULT '/',
  title       TEXT,
  referrer    TEXT,
  visitor_id  TEXT,
  session_id  TEXT,
  device      TEXT DEFAULT 'unknown',
  browser     TEXT DEFAULT 'unknown',
  country     TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_client_created_idx ON public.analytics_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_client_path_idx    ON public.analytics_events (client_id, path);
CREATE INDEX IF NOT EXISTS analytics_events_client_event_idx   ON public.analytics_events (client_id, event_name);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_select_authenticated" ON public.analytics_events;
CREATE POLICY "analytics_select_authenticated" ON public.analytics_events
  FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());

-- Deliberately NO public INSERT policy, unlike 001's `analytics_public_insert`.
-- The only writer is /api/client/{slug}/analytics, which uses the
-- service-role client and bypasses RLS anyway. That route is where rate
-- limiting, user-agent parsing and path cleaning happen; an anon-key INSERT
-- would skip all three and let anyone write arbitrary rows. Matches the
-- service-role-only pattern already used by api_keys and
-- client_publish_config.
