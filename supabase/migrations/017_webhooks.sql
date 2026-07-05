-- Task 7.1: Publish webhooks + deploy triggers.
--
-- `webhook_deliveries` is an append-only observability log of outbound
-- webhook attempts (`revalidate_url` + `deploy_hook`) fired by
-- `notifyPublish` (src/lib/publish.ts). Rows are written exclusively by
-- server-side callers using the service-role admin client (the new
-- `/api/publish/notify` route and the `publish-scheduled` cron both use
-- `createAdminClient()`), which bypasses RLS entirely — there is
-- deliberately no INSERT/UPDATE/DELETE policy for `authenticated`/`anon`
-- below, since a regular CMS session should never write delivery rows
-- directly. Broad authenticated SELECT (scoped to the caller's own client,
-- or all clients for `ne_admin`) is fine per the Phase 5 posture rule for
-- operational/observability data that isn't schema-sensitive. No anon
-- access at all: this is purely a dashboard-facing delivery log, never
-- consumed by client sites (client sites receive the webhook POST itself,
-- not read access to this table).
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  url         TEXT NOT NULL,
  event       TEXT NOT NULL,              -- 'content.published' | 'content.updated' | 'content.deleted'
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INT,
  ok          BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_client_created_idx
  ON public.webhook_deliveries (client_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_deliveries_select" ON public.webhook_deliveries
  FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());

-- clients.deploy_hook already exists (migration 001) — only revalidate_url/
-- revalidate_secret are new. revalidate_secret is the HMAC signing key
-- notifyPublish uses to sign the JSON body POSTed to revalidate_url; it is
-- never returned to the browser by any route (see /api/publish/notify).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS revalidate_url TEXT,
  ADD COLUMN IF NOT EXISTS revalidate_secret TEXT;
