-- Flag bot/crawler traffic instead of dropping it, so the Analytics screen can
-- exclude it by default (and still show it on request). New events are flagged
-- by the beacon from the User-Agent (src/lib/analytics/bots.ts).
ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS analytics_events_client_bot_created_idx
  ON public.analytics_events (client_id, is_bot, created_at DESC);

-- Historical rows never stored the User-Agent, so the only reliable signal is
-- the parser's fallback bucket: browser = 'Other' means the UA matched none of
-- Chrome/Edge/Safari/Firefox/Opera, which in practice is crawlers and HTTP
-- clients. Real-browser bots that spoof a Chrome UA can't be identified after
-- the fact.
UPDATE public.analytics_events SET is_bot = true WHERE browser = 'Other' AND is_bot = false;
