-- Analytics v2, Phase 2 — marketing attribution.
--
-- 1. analytics_traffic_sources: extra referrer hosts (host → source name and
--    category) that extend the built-in lists in src/lib/analytics/channels.ts
--    without a deploy. The beacon reads it with the service role (cached).
-- 2. analytics_channel_from_host(): channel from a referrer host alone. Its
--    CASE body is GENERATED from channels.ts (`channelFromHostSql`), so the
--    backfill and the beacon share one definition. Used to backfill rows that
--    predate channel derivation and as a fallback for rows without a channel.
-- 3. Backfill `channel` on historical rows. They carry no UTM / click-ID data
--    (the old tracker never sent it), so their channel comes from the
--    referrer only — the UI says so.
-- 4. Session-level RPCs: analytics_session_breakdown (channel, source,
--    source / medium, campaign, landing page, search engine, social network,
--    AI assistant — with engagement and conversions per row) and
--    analytics_session_timeseries (sessions per channel over time).
--    A session is attributed by its first page view in the range.

-- ── 1. Editable traffic sources ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_traffic_sources (
  host        TEXT PRIMARY KEY CHECK (host = lower(host) AND host <> ''),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('search', 'social', 'ai', 'email')),
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.analytics_traffic_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "traffic_sources_read" ON public.analytics_traffic_sources;
CREATE POLICY "traffic_sources_read" ON public.analytics_traffic_sources
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "traffic_sources_admin_write" ON public.analytics_traffic_sources;
CREATE POLICY "traffic_sources_admin_write" ON public.analytics_traffic_sources
  FOR ALL TO authenticated USING ((SELECT is_ne_admin())) WITH CHECK ((SELECT is_ne_admin()));

-- ── 2. Channel from referrer host (generated from channels.ts) ─────────────
CREATE OR REPLACE FUNCTION public.analytics_channel_from_host(p_host TEXT, p_site_host TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_host IS NULL THEN 'Direct'
    WHEN p_host = p_site_host OR p_host LIKE '%.' || p_site_host THEN 'Direct'
    WHEN p_host ~ '(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|(^|\.)perplexity\.ai$|(^|\.)gemini\.google\.com$|(^|\.)bard\.google\.com$|(^|\.)copilot\.microsoft\.com$|(^|\.)claude\.ai$|(^|\.)you\.com$|(^|\.)phind\.com$|(^|\.)poe\.com$|(^|\.)chat\.deepseek\.com$|(^|\.)deepseek\.com$|(^|\.)meta\.ai$|(^|\.)grok\.com$|(^|\.)chat\.mistral\.ai$' THEN 'AI Assistants'
    WHEN p_host ~ '(^|\.)mail\.google\.com$|(^|\.)outlook\.live\.com$|(^|\.)outlook\.office\.com$|(^|\.)outlook\.office365\.com$|(^|\.)mail\.yahoo\.com$|(^|\.)mail\.proton\.me$|(^|\.)mail\.zoho\.com$' THEN 'Email'
    WHEN p_host ~ '(^|\.)google(\.|$)|(^|\.)bing\.com$|(^|\.)yahoo(\.|$)|(^|\.)duckduckgo\.com$|(^|\.)baidu\.com$|(^|\.)yandex(\.|$)|(^|\.)ecosia\.org$|(^|\.)naver\.com$|(^|\.)search\.brave\.com$|(^|\.)startpage\.com$|(^|\.)sogou\.com$|(^|\.)so\.com$|(^|\.)seznam\.cz$|(^|\.)qwant\.com$|(^|\.)coccoc\.com$|(^|\.)daum\.net$|(^|\.)ask\.com$' THEN 'Organic Search'
    WHEN p_host ~ '(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$|(^|\.)instagram\.com$|(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)linkedin\.com$|(^|\.)lnkd\.in$|(^|\.)pinterest(\.|$)|(^|\.)pin\.it$|(^|\.)reddit\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)tiktok\.com$|(^|\.)threads\.net$|(^|\.)whatsapp\.com$|(^|\.)wa\.me$|(^|\.)t\.me$|(^|\.)telegram\.org$|(^|\.)xiaohongshu\.com$|(^|\.)weibo\.com$|(^|\.)line\.me$|(^|\.)snapchat\.com$|(^|\.)quora\.com$|(^|\.)discord\.com$|(^|\.)tumblr\.com$|(^|\.)vk\.com$|(^|\.)bsky\.app$|(^|\.)medium\.com$' THEN 'Organic Social'
    ELSE 'Referral'
  END;
$$;

-- `clients.website_url` → bare lower-case host without www.
CREATE OR REPLACE FUNCTION public.analytics_site_host(p_url TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT NULLIF(lower(regexp_replace(
    substring(CASE WHEN p_url ~* '^https?://' THEN p_url ELSE 'https://' || p_url END
              FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'), '^www\.', '')), '');
$$;

-- ── 3. Backfill ────────────────────────────────────────────────────────────
UPDATE public.analytics_events e
SET channel = public.analytics_channel_from_host(e.referrer_host, public.analytics_site_host(c.website_url))
FROM public.clients c
WHERE c.id = e.client_id AND e.channel IS NULL;

CREATE INDEX IF NOT EXISTS analytics_events_client_channel_idx
  ON public.analytics_events (client_id, channel, created_at) WHERE event_name = 'page_view';

-- ── 4. Session RPCs ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_session_breakdown(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_dimension TEXT,
  p_include_bots BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 10,
  p_engaged_ms INTEGER DEFAULT 10000,
  p_engaged_views INTEGER DEFAULT 2,
  p_conversion_events TEXT[] DEFAULT ARRAY['form_submit'],
  p_engagement_tv INTEGER DEFAULT 3
)
RETURNS TABLE (
  name TEXT, sessions BIGINT, visitors BIGINT, page_views BIGINT,
  measured_sessions BIGINT, engaged_sessions BIGINT, converting_sessions BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  lim INTEGER := least(greatest(coalesce(p_limit, 10), 1), 1000);
BEGIN
  IF p_dimension NOT IN ('channel', 'source', 'source_medium', 'campaign', 'landing_page',
                         'search_engine', 'social_network', 'ai_assistant') THEN
    RAISE EXCEPTION 'Unknown session dimension: %', p_dimension USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH ev AS MATERIALIZED (
    SELECT * FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) w
    WHERE w.session_id IS NOT NULL
  ),
  entry AS (
    SELECT DISTINCT ON (ev.session_id)
      ev.session_id, ev.client_id, ev.path, ev.landing_path, ev.channel, ev.referrer_host,
      ev.utm_source, ev.utm_medium, ev.utm_campaign
    FROM ev
    WHERE ev.event_name = 'page_view'
    ORDER BY ev.session_id, ev.created_at, ev.id
  ),
  agg AS (
    SELECT
      ev.session_id,
      min(ev.visitor_id) AS visitor_id,
      count(*) FILTER (WHERE ev.event_name = 'page_view') AS pv,
      coalesce(sum(greatest(ev.engaged_ms, 0)), 0) AS engaged,
      bool_or(coalesce(ev.tracker_version, 0) >= p_engagement_tv) AS measured,
      bool_or(ev.event_name = ANY (p_conversion_events)) AS converted
    FROM ev
    GROUP BY ev.session_id
  ),
  s AS (
    SELECT
      a.*,
      e.referrer_host AS raw_host,
      coalesce(e.channel, public.analytics_channel_from_host(e.referrer_host, public.analytics_site_host(c.website_url))) AS ch,
      e.utm_source, e.utm_medium, e.utm_campaign,
      coalesce(e.landing_path, e.path) AS landing
    FROM entry e
    JOIN agg a ON a.session_id = e.session_id
    LEFT JOIN public.clients c ON c.id = e.client_id
  ),
  s2 AS (
    -- Source: the UTM source, else the referring host (a self-referral is direct).
    SELECT s.*, coalesce(s.utm_source, CASE WHEN s.ch = 'Direct' THEN NULL ELSE s.raw_host END) AS src
    FROM s
  ),
  keyed AS (
    SELECT
      CASE p_dimension
        WHEN 'channel' THEN s.ch
        WHEN 'source' THEN coalesce(s.src, '(direct)')
        WHEN 'source_medium' THEN coalesce(s.src, '(direct)') || ' / ' ||
          coalesce(s.utm_medium, CASE s.ch
            WHEN 'Organic Search' THEN 'organic' WHEN 'Organic Social' THEN 'social'
            WHEN 'Email' THEN 'email' WHEN 'Direct' THEN '(none)' ELSE 'referral' END)
        WHEN 'campaign' THEN s.utm_campaign
        WHEN 'landing_page' THEN s.landing
        ELSE s.src
      END AS k,
      s.*
    FROM s2 s
    WHERE CASE p_dimension
      WHEN 'campaign' THEN s.utm_campaign IS NOT NULL
      WHEN 'search_engine' THEN s.ch IN ('Organic Search', 'Paid Search')
      WHEN 'social_network' THEN s.ch IN ('Organic Social', 'Paid Social')
      WHEN 'ai_assistant' THEN s.ch = 'AI Assistants'
      ELSE true
    END
  )
  SELECT
    coalesce(nullif(keyed.k, ''), '(not set)'),
    count(*)::BIGINT,
    count(DISTINCT keyed.visitor_id)::BIGINT,
    sum(keyed.pv)::BIGINT,
    count(*) FILTER (WHERE keyed.measured)::BIGINT,
    count(*) FILTER (WHERE keyed.measured AND (keyed.engaged >= p_engaged_ms OR keyed.pv >= p_engaged_views OR keyed.converted))::BIGINT,
    count(*) FILTER (WHERE keyed.converted)::BIGINT
  FROM keyed
  GROUP BY 1
  ORDER BY 2 DESC, 1
  LIMIT lim;
END;
$$;

-- Sessions per channel per bucket (a session counts in the bucket of its
-- first page view), bucketed in p_tz like analytics_timeseries.
CREATE OR REPLACE FUNCTION public.analytics_session_timeseries(
  p_client UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_granularity TEXT DEFAULT 'day',
  p_tz TEXT DEFAULT 'UTC',
  p_include_bots BOOLEAN DEFAULT false
)
RETURNS TABLE (bucket TIMESTAMP, name TEXT, sessions BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH z AS MATERIALIZED (
    SELECT public.analytics_safe_tz(p_tz) AS tz,
           CASE WHEN p_granularity IN ('hour', 'day', 'week', 'month') THEN p_granularity ELSE 'day' END AS g
  ),
  entry AS (
    SELECT DISTINCT ON (e.session_id) e.session_id, e.created_at, e.client_id, e.channel, e.referrer_host
    FROM public.analytics_window(p_client, p_from, p_to, p_include_bots) e
    WHERE e.event_name = 'page_view' AND e.session_id IS NOT NULL
    ORDER BY e.session_id, e.created_at, e.id
  )
  SELECT
    date_trunc(z.g, entry.created_at AT TIME ZONE z.tz),
    coalesce(entry.channel, public.analytics_channel_from_host(entry.referrer_host, public.analytics_site_host(c.website_url))),
    count(*)::BIGINT
  FROM entry
  CROSS JOIN z
  LEFT JOIN public.clients c ON c.id = entry.client_id
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.analytics_channel_from_host(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_site_host(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_session_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, TEXT[], INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.analytics_session_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_channel_from_host(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_site_host(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_session_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_session_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) TO authenticated;
