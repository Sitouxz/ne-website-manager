-- Assertions for migration 027's analytics RPCs. The client-A sessions are
-- the same ones src/lib/analytics/metrics.test.ts uses, so the SQL and the
-- TypeScript reference implementation agree on every metric definition.
-- Run via scripts/test-analytics-sql.sh.
\set ON_ERROR_STOP 1

INSERT INTO public.clients (id, name, slug, website_url) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Acme', 'acme', 'https://www.acme.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'Beta', 'beta', 'https://beta.test');
INSERT INTO public.profiles (id, client_id, role) VALUES
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000a1', 'client_admin'),
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000b1', 'client_admin'),
  ('00000000-0000-0000-0000-00000000cccc', NULL, 'ne_admin');

-- Client A, 10 Sep 2026 (UTC).
INSERT INTO public.analytics_events
  (client_id, event_name, path, session_id, visitor_id, referrer_host, engaged_ms, is_new_visitor, tracker_version, is_bot, created_at)
SELECT '00000000-0000-0000-0000-0000000000a1', e, p, s, v, r, ms, nv, tv, bot, t::timestamptz
FROM (VALUES
  -- s1: 1 page, 12 s engaged → engaged; from google
  ('page_view',  '/',        's1', 'v1', 'google.com',   NULL,  true,  3, false, '2026-09-10 01:00:00Z'),
  ('page_leave', '/',        's1', 'v1', NULL,           12000, true,  3, false, '2026-09-10 01:00:20Z'),
  -- s2: 2 pages → engaged; direct; second view has an internal referrer
  ('page_view',  '/a',       's2', 'v2', NULL,           NULL,  false, 3, false, '2026-09-10 02:00:00Z'),
  ('page_view',  '/b',       's2', 'v2', 'acme.com',     NULL,  false, 3, false, '2026-09-10 02:01:00Z'),
  -- s3: 1 page + form submit → engaged; self-referral counts as Direct
  ('page_view',  '/contact', 's3', 'v3', 'acme.com',     NULL,  true,  3, false, '2026-09-10 03:00:00Z'),
  ('form_submit','/contact', 's3', 'v3', NULL,           NULL,  true,  3, false, '2026-09-10 03:01:00Z'),
  -- s4: 1 page, 9.9 s over two flushes → not engaged
  ('page_view',  '/',        's4', 'v4', NULL,           NULL,  false, 3, false, '2026-09-10 04:00:00Z'),
  ('page_leave', '/',        's4', 'v4', NULL,           5000,  false, 3, false, '2026-09-10 04:00:05Z'),
  ('page_leave', '/',        's4', 'v4', NULL,           4900,  false, 3, false, '2026-09-10 04:00:10Z'),
  -- s5: legacy tracker (no tv) → not measured; referrer repeated on the 2nd view
  ('page_view',  '/',        's5', 'v5', 'facebook.com', NULL,  NULL,  NULL, false, '2026-09-10 05:00:00Z'),
  ('page_view',  '/a',       's5', 'v5', 'facebook.com', NULL,  NULL,  NULL, false, '2026-09-10 17:00:00Z'),
  -- bot, excluded by default
  ('page_view',  '/',        'sb', 'vb', NULL,           NULL,  NULL,  NULL, true,  '2026-09-10 06:00:00Z'),
  -- outside the window
  ('page_view',  '/',        's9', 'v9', NULL,           NULL,  NULL,  NULL, false, '2026-09-20 06:00:00Z')
) AS x(e, p, s, v, r, ms, nv, tv, bot, t);

INSERT INTO public.analytics_events (client_id, event_name, path, session_id, visitor_id, created_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'page_view', '/b-only', 'x1', 'y1', '2026-09-10 01:00:00Z');

CREATE OR REPLACE FUNCTION pg_temp.eq(label TEXT, actual ANYELEMENT, expected ANYELEMENT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', label, expected, actual;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.eq(TEXT, ANYELEMENT, ANYELEMENT) TO authenticated;

-- ── As client A's admin ────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', false);

SELECT pg_temp.eq('overview', public.analytics_overview(
  '00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11'),
  '{"page_views":7,"visitors":5,"sessions":5,"custom_events":1,"event_types":1,
    "measured_sessions":4,"engaged_sessions":3,"total_engaged_ms":21900,
    "measured_visitors":4,"new_visitors":2,"conversions":1,"tracker_version":3}'::jsonb);

SELECT pg_temp.eq('overview incl. bots: page views',
  (public.analytics_overview('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', true) ->> 'page_views')::int, 8);

SELECT pg_temp.eq('referrers (session start, self-referral = Direct)',
  (SELECT string_agg(name || '=' || count, ',' ORDER BY count DESC, name)
   FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'referrer')),
  'Direct=3,facebook.com=1,google.com=1');

SELECT pg_temp.eq('entry pages',
  (SELECT string_agg(name || '=' || count, ',' ORDER BY count DESC, name)
   FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'entry_page')),
  '/=3,/a=1,/contact=1');

SELECT pg_temp.eq('exit pages',
  (SELECT string_agg(name || '=' || count, ',' ORDER BY count DESC, name)
   FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'exit_page')),
  '/=2,/a=1,/b=1,/contact=1');

SELECT pg_temp.eq('top pages (views, visitors)',
  (SELECT string_agg(name || '=' || count || '/' || visitors, ',' ORDER BY count DESC, name)
   FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'page')),
  '/=3/3,/a=2/2,/b=1/1,/contact=1/1');

SELECT pg_temp.eq('events exclude page_leave',
  (SELECT string_agg(name || '=' || count, ',' ORDER BY count DESC, name)
   FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'event')),
  'page_view=7,form_submit=1');

SELECT pg_temp.eq('breakdown limit',
  (SELECT count(*)::int FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'page', false, 2)), 2);

SELECT pg_temp.eq('timeseries, days in Asia/Singapore',
  (SELECT string_agg(to_char(bucket, 'YYYY-MM-DD') || '=' || views, ',' ORDER BY bucket)
   FROM public.analytics_timeseries('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'day', 'Asia/Singapore')),
  '2026-09-10=6,2026-09-11=1');

SELECT pg_temp.eq('timeseries, days in UTC',
  (SELECT string_agg(to_char(bucket, 'YYYY-MM-DD') || '=' || views || '/' || visitors || '/' || sessions, ',' ORDER BY bucket)
   FROM public.analytics_timeseries('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'day', 'UTC')),
  '2026-09-10=7/5/5');

SELECT pg_temp.eq('timeseries, bad tz falls back to UTC',
  (SELECT count(*)::int FROM public.analytics_timeseries('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'day', 'Mars/Olympus')), 1);

SELECT pg_temp.eq('hourly heatmap (SGT)',
  (SELECT string_agg(dow || ':' || hour || '=' || views, ',' ORDER BY dow, hour)
   FROM public.analytics_hourly('00000000-0000-0000-0000-0000000000a1', '2026-09-10', '2026-09-11', 'Asia/Singapore')),
  '4:9=1,4:10=2,4:11=1,4:12=1,4:13=1,5:1=1');

-- RLS: client A's admin cannot see client B, even by asking for it.
SELECT pg_temp.eq('RLS hides other clients',
  (public.analytics_overview('00000000-0000-0000-0000-0000000000b1', '2026-09-10', '2026-09-11') ->> 'page_views')::int, 0);
SELECT pg_temp.eq('RLS: all-clients view is own client only',
  (public.analytics_overview(NULL, '2026-09-10', '2026-09-11') ->> 'page_views')::int, 7);

DO $$ BEGIN
  PERFORM public.analytics_breakdown(NULL, '2026-09-10', '2026-09-11', 'password');
  RAISE EXCEPTION 'FAIL unknown dimension accepted';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok  unknown dimension rejected';
END $$;

-- ── As an NE admin ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cccc', false);
SELECT pg_temp.eq('ne_admin sees all clients',
  (public.analytics_overview(NULL, '2026-09-10', '2026-09-11') ->> 'page_views')::int, 8);
RESET ROLE;

-- ── Anonymous callers cannot run the RPCs ──────────────────────────────────
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.analytics_overview(NULL, '2026-09-10', '2026-09-11');
  RAISE EXCEPTION 'FAIL anon could execute analytics_overview';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon denied';
END $$;
RESET ROLE;

-- ── Timezone validation on clients ─────────────────────────────────────────
DO $$ BEGIN
  UPDATE public.clients SET timezone = 'Not/AZone' WHERE slug = 'acme';
  RAISE EXCEPTION 'FAIL invalid timezone accepted';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok  invalid timezone rejected';
END $$;
SELECT pg_temp.eq('default timezone', (SELECT timezone FROM public.clients WHERE slug = 'acme'), 'Asia/Singapore');

-- ── Optional scale check ───────────────────────────────────────────────────
SELECT (:seed_events)::int > 0 AS do_seed \gset
\if :do_seed
INSERT INTO public.analytics_events
  (client_id, event_name, path, session_id, visitor_id, referrer_host, engaged_ms, is_new_visitor, tracker_version, device, browser, country, created_at)
SELECT
  '00000000-0000-0000-0000-0000000000a1',
  CASE WHEN g % 3 = 0 THEN 'page_leave' ELSE 'page_view' END,
  '/p' || (g % 200),
  's' || (g / 4),
  'v' || (g / 10),
  (ARRAY[NULL, 'google.com', 'acme.com', 'facebook.com'])[1 + g % 4],
  CASE WHEN g % 3 = 0 THEN (g % 30) * 1000 END,
  (g / 10) % 3 = 0,
  3,
  (ARRAY['desktop', 'mobile', 'tablet'])[1 + g % 3],
  'Chrome',
  (ARRAY['SG', 'MY', 'US', 'ID'])[1 + g % 4],
  timestamptz '2026-06-01' + (g * interval '1 second' * (90 * 86400.0 / :seed_events))
FROM generate_series(1, :seed_events) g;
ANALYZE public.analytics_events;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', false);
\timing on
SELECT public.analytics_overview('00000000-0000-0000-0000-0000000000a1', '2026-06-01', '2026-09-01') ->> 'page_views' AS overview_90d_page_views;
SELECT count(*) AS referrer_rows FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-06-01', '2026-09-01', 'referrer');
SELECT count(*) AS page_rows FROM public.analytics_breakdown('00000000-0000-0000-0000-0000000000a1', '2026-06-01', '2026-09-01', 'page', false, 1000);
SELECT count(*) AS day_buckets FROM public.analytics_timeseries('00000000-0000-0000-0000-0000000000a1', '2026-06-01', '2026-09-01', 'day', 'Asia/Singapore');
SELECT count(*) AS heatmap_cells FROM public.analytics_hourly('00000000-0000-0000-0000-0000000000a1', '2026-06-01', '2026-09-01', 'Asia/Singapore');
\timing off
RESET ROLE;
\endif
