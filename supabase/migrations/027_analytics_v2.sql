-- Analytics v2, Phase 1 (docs/superpowers/plans/2026-09-30-analytics-v2-plan.md).
--
-- 1. New nullable columns on analytics_events for tracker v3 (engagement,
--    audience) and for Phase 2 attribution (utm_*, channel, landing_path).
--    All additive; rows from older trackers simply leave them NULL, and the
--    dashboard treats NULL as "not collected", never as 0.
-- 2. referrer_host, derived server-side at ingest and backfilled here.
-- 3. clients.timezone: day bucketing happens in the client's zone.
-- 4. Indexes for the aggregation RPCs.
-- 5. RLS policy rewritten with (select …) wrappers so the auth helpers run
--    once per query instead of once per row.
-- 6. Aggregation RPCs (SECURITY INVOKER — RLS still decides which rows the
--    caller can see): analytics_overview, analytics_breakdown,
--    analytics_timeseries, analytics_hourly. Metric definitions live in
--    src/lib/analytics/metrics.ts; its constants are passed in as arguments.
--    Tested by supabase/tests/analytics_v2.test.sql
--    (scripts/test-analytics-sql.sh).
--
-- Applied to the live project via MCP `apply_migration` (name: analytics_v2).
-- Note: the live project also has an unrelated migration named
-- `027_releases` (applied from another repository). Supabase versions
-- migrations by timestamp, so the shared number is cosmetic.

-- ── 1–2. Columns ───────────────────────────────────────────────────────────
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS utm_source      TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium      TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign    TEXT,
  ADD COLUMN IF NOT EXISTS utm_term        TEXT,
  ADD COLUMN IF NOT EXISTS utm_content     TEXT,
  ADD COLUMN IF NOT EXISTS click_id_type   TEXT,
  ADD COLUMN IF NOT EXISTS channel         TEXT,
  ADD COLUMN IF NOT EXISTS landing_path    TEXT,
  ADD COLUMN IF NOT EXISTS referrer_host   TEXT,
  ADD COLUMN IF NOT EXISTS is_entry        BOOLEAN,
  ADD COLUMN IF NOT EXISTS engaged_ms      INTEGER,
  ADD COLUMN IF NOT EXISTS scroll_pct      SMALLINT,
  ADD COLUMN IF NOT EXISTS is_new_visitor  BOOLEAN,
  ADD COLUMN IF NOT EXISTS screen_w        INTEGER,
  ADD COLUMN IF NOT EXISTS lang            TEXT,
  ADD COLUMN IF NOT EXISTS tracker_version SMALLINT;

-- Same normalization as hostOf() in src/lib/analytics/ingest.ts.
UPDATE public.analytics_events
SET referrer_host = NULLIF(lower(regexp_replace(
      substring(referrer FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\.', '')), '')
WHERE referrer IS NOT NULL AND referrer_host IS NULL;

-- ── 3. Client timezone ─────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Singapore';

CREATE OR REPLACE FUNCTION public.validate_client_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_client_timezone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_validate_timezone ON public.clients;
CREATE TRIGGER clients_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.validate_client_timezone();

-- ── 4. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS analytics_events_client_pageview_created_idx
  ON public.analytics_events (client_id, created_at) WHERE event_name = 'page_view';
CREATE INDEX IF NOT EXISTS analytics_events_client_session_idx
  ON public.analytics_events (client_id, session_id);
CREATE INDEX IF NOT EXISTS analytics_events_client_visitor_idx
  ON public.analytics_events (client_id, visitor_id);

-- ── 5. RLS: evaluate auth helpers once per statement ───────────────────────
DROP POLICY IF EXISTS "analytics_select_authenticated" ON public.analytics_events;
CREATE POLICY "analytics_select_authenticated" ON public.analytics_events
  FOR SELECT USING (client_id = (SELECT my_client_id()) OR (SELECT is_ne_admin()));

-- ── 6. RPCs ────────────────────────────────────────────────────────────────

-- Returns p_tz when Postgres knows it, else 'UTC' (AT TIME ZONE would raise).
CREATE OR REPLACE FUNCTION public.analytics_safe_tz(p_tz TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'UTC' END;
$$;

-- Events visible to the caller (RLS) in [p_from, p_to), optionally one client.
-- Deliberately has no `SET search_path` (every name is schema-qualified):
-- a SET clause stops Postgres from inlining a SQL function, and inlining is
-- what lets the callers' filters and aggregates run as one plan instead of
-- materializing every row of the window first.
CREATE OR REPLACE FUNCTION public.analytics_window(
  p_client UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_include_bots BOOLEAN
)
RETURNS SETOF public.analytics_events
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT e.*
  FROM public.analytics_events e
  WHERE (p_client IS NULL OR e.client_id = p_client)
    AND e.created_at >= p_from
    AND e.created_at <  p_to
    AND (p_include_bots OR NOT e.is_bot);
$$;

CREATE OR REPLACE FUNCTION public.analytics_overview(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_include_bots BOOLEAN DEFAULT false,
  p_engaged_ms INTEGER DEFAULT 10000,
  p_engaged_views INTEGER DEFAULT 2,
  p_conversion_events TEXT[] DEFAULT ARRAY['form_submit'],
  p_system_events TEXT[] DEFAULT ARRAY['page_view', 'page_leave'],
  p_engagement_tv INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  -- One grouped pass over the window per (session, visitor), then sessions
  -- and visitors are totalled from those (far fewer) groups. Much cheaper
  -- than several COUNT(DISTINCT …) over raw events.
  WITH grp AS MATERIALIZED (
    SELECT
      session_id,
      visitor_id,
      count(*) FILTER (WHERE event_name = 'page_view') AS pv,
      count(*) FILTER (WHERE NOT event_name = ANY (p_system_events)) AS custom,
      count(*) FILTER (WHERE event_name = ANY (p_conversion_events)) AS conversions,
      coalesce(sum(greatest(engaged_ms, 0)), 0) AS engaged,
      bool_or(coalesce(tracker_version, 0) >= p_engagement_tv) AS measured,
      bool_or(is_new_visitor IS NOT NULL) AS has_new_flag,
      coalesce(bool_or(is_new_visitor), false) AS is_new,
      max(tracker_version) AS tv
    FROM public.analytics_window(p_client, p_from, p_to, p_include_bots)
    GROUP BY session_id, visitor_id
  ),
  sess AS (
    SELECT sum(pv) AS pv, sum(engaged) AS engaged, sum(conversions) AS conversions, bool_or(measured) AS measured
    FROM grp
    WHERE session_id IS NOT NULL
    GROUP BY session_id
  ),
  vis AS (
    SELECT bool_or(has_new_flag) AS measured, bool_or(is_new) AS is_new
    FROM grp
    WHERE visitor_id IS NOT NULL
    GROUP BY visitor_id
  )
  SELECT jsonb_build_object(
    'page_views',        (SELECT coalesce(sum(pv), 0) FROM grp),
    'visitors',          (SELECT count(*) FROM vis),
    'sessions',          (SELECT count(*) FROM sess),
    'custom_events',     (SELECT coalesce(sum(custom), 0) FROM grp),
    'event_types',       (SELECT count(*) FROM (
                            SELECT e.event_name
                            FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
                            WHERE NOT e.event_name = ANY (p_system_events)
                            GROUP BY e.event_name) x),
    'measured_sessions', (SELECT count(*) FROM sess WHERE measured),
    'engaged_sessions',  (SELECT count(*) FROM sess WHERE measured
                            AND (engaged >= p_engaged_ms OR pv >= p_engaged_views OR conversions > 0)),
    'total_engaged_ms',  (SELECT coalesce(sum(engaged), 0) FROM sess WHERE measured),
    'measured_visitors', (SELECT count(*) FROM vis WHERE measured),
    'new_visitors',      (SELECT count(*) FROM vis WHERE is_new),
    'conversions',       (SELECT coalesce(sum(conversions), 0) FROM grp),
    'tracker_version',   (SELECT max(tv) FROM grp)
  );
$$;

-- Ranked breakdown by one dimension. Session-based dimensions (entry_page,
-- exit_page, referrer) count sessions; page/device/browser/country/lang/
-- screen count page views; event counts events (page_leave excluded).
-- Referrer = the referrer host of each session's first page view; a missing
-- referrer or one from the client's own site (website_url host) is Direct.
CREATE OR REPLACE FUNCTION public.analytics_breakdown(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_dimension TEXT,
  p_include_bots BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (name TEXT, count BIGINT, visitors BIGINT, sessions BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  lim INTEGER := least(greatest(coalesce(p_limit, 10), 1), 5000);
BEGIN
  IF p_dimension IN ('entry_page', 'exit_page', 'referrer') THEN
    RETURN QUERY
    WITH pv AS (
      SELECT e.client_id, e.session_id, e.visitor_id, e.path, e.referrer_host,
             row_number() OVER (PARTITION BY e.session_id ORDER BY e.created_at, e.id) AS first_rank,
             row_number() OVER (PARTITION BY e.session_id ORDER BY e.created_at DESC, e.id DESC) AS last_rank
      FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
      WHERE e.event_name = 'page_view' AND e.session_id IS NOT NULL
    ),
    picked AS (
      SELECT
        CASE p_dimension
          WHEN 'exit_page' THEN pv.path
          WHEN 'entry_page' THEN pv.path
          ELSE CASE
            WHEN pv.referrer_host IS NULL THEN 'Direct'
            WHEN pv.referrer_host = lower(regexp_replace(substring(c.website_url FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\.', '')) THEN 'Direct'
            ELSE pv.referrer_host
          END
        END AS k,
        pv.session_id, pv.visitor_id
      FROM pv
      LEFT JOIN public.clients c ON c.id = pv.client_id
      WHERE (p_dimension = 'exit_page' AND pv.last_rank = 1)
         OR (p_dimension <> 'exit_page' AND pv.first_rank = 1)
    )
    SELECT coalesce(nullif(picked.k, ''), 'Unknown'), count(*)::BIGINT, count(DISTINCT picked.visitor_id)::BIGINT, count(*)::BIGINT
    FROM picked
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT lim;
    RETURN;
  END IF;

  IF p_dimension = 'event' THEN
    RETURN QUERY
    SELECT e.event_name, count(*)::BIGINT, count(DISTINCT e.visitor_id)::BIGINT, count(DISTINCT e.session_id)::BIGINT
    FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
    WHERE e.event_name <> 'page_leave'
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT lim;
    RETURN;
  END IF;

  IF p_dimension NOT IN ('page', 'device', 'browser', 'country', 'lang', 'screen') THEN
    RAISE EXCEPTION 'Unknown analytics dimension: %', p_dimension USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    coalesce(nullif(CASE p_dimension
      WHEN 'page' THEN e.path
      WHEN 'device' THEN e.device
      WHEN 'browser' THEN e.browser
      WHEN 'country' THEN e.country
      WHEN 'lang' THEN e.lang
      WHEN 'screen' THEN CASE
        WHEN e.screen_w IS NULL THEN NULL
        WHEN e.screen_w < 640 THEN 'Under 640 px'
        WHEN e.screen_w < 1024 THEN '640–1023 px'
        WHEN e.screen_w < 1440 THEN '1024–1439 px'
        ELSE '1440 px and wider'
      END
    END, ''), 'Unknown') AS k,
    count(*)::BIGINT,
    count(DISTINCT e.visitor_id)::BIGINT,
    count(DISTINCT e.session_id)::BIGINT
  FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
  WHERE e.event_name = 'page_view'
    AND (p_dimension NOT IN ('lang', 'screen') OR (CASE WHEN p_dimension = 'lang' THEN e.lang IS NOT NULL ELSE e.screen_w IS NOT NULL END))
  GROUP BY 1
  ORDER BY 2 DESC, 1
  LIMIT lim;
END;
$$;

-- Page views / visitors / sessions per hour, day, ISO week or month, bucketed
-- in p_tz. `bucket` is the local wall-clock start of the bucket. Empty
-- buckets are not returned; the client fills gaps.
CREATE OR REPLACE FUNCTION public.analytics_timeseries(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_granularity TEXT DEFAULT 'day',
  p_tz TEXT DEFAULT 'UTC',
  p_include_bots BOOLEAN DEFAULT false
)
RETURNS TABLE (bucket TIMESTAMP, views BIGINT, visitors BIGINT, sessions BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  -- The zone is resolved once (a CTE), not per row.
  WITH z AS MATERIALIZED (
    SELECT public.analytics_safe_tz(p_tz) AS tz,
           CASE WHEN p_granularity IN ('hour', 'day', 'week', 'month') THEN p_granularity ELSE 'day' END AS g
  )
  SELECT
    date_trunc(z.g, e.created_at AT TIME ZONE z.tz) AS bucket,
    count(*)::BIGINT,
    count(DISTINCT e.visitor_id)::BIGINT,
    count(DISTINCT e.session_id)::BIGINT
  FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
  CROSS JOIN z
  WHERE e.event_name = 'page_view'
  GROUP BY 1
  ORDER BY 1;
$$;

-- Page views by local day of week (0 = Sunday) × hour.
CREATE OR REPLACE FUNCTION public.analytics_hourly(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_tz TEXT DEFAULT 'UTC',
  p_include_bots BOOLEAN DEFAULT false
)
RETURNS TABLE (dow INTEGER, hour INTEGER, views BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH z AS MATERIALIZED (SELECT public.analytics_safe_tz(p_tz) AS tz)
  SELECT
    extract(dow FROM e.created_at AT TIME ZONE z.tz)::INTEGER,
    extract(hour FROM e.created_at AT TIME ZONE z.tz)::INTEGER,
    count(*)::BIGINT
  FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
  CROSS JOIN z
  WHERE e.event_name = 'page_view'
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- Dashboard-only: no anonymous access.
REVOKE EXECUTE ON FUNCTION public.analytics_safe_tz(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_window(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, TEXT[], TEXT[], INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_hourly(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_safe_tz(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_window(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, TEXT[], TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_hourly(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN) TO authenticated;
