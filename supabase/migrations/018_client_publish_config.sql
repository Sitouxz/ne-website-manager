-- Fix for Task 7.1 Finding 1 (Critical): `clients.deploy_hook` /
-- `revalidate_url` / `revalidate_secret` were added directly onto `clients`,
-- a table with an unconditionally public-read RLS policy
-- (`clients_public_read`, `USING (true)`, `anon` SELECT granted — see
-- migration 019 for that policy's own separate drift bug). Any
-- unauthenticated caller holding the public anon key can call
-- `GET .../rest/v1/clients?select=*` directly and read every client's
-- `revalidate_secret` in plaintext (defeating the HMAC signing scheme
-- entirely) and `deploy_hook` (itself a bearer-token-equivalent deploy
-- trigger URL, pre-existing since migration 001 but newly worth fixing here
-- since we're already restructuring this data).
--
-- Fix, following the exact precedent set by `api_keys` (migration 004): a
-- table storing secrets/bearer-equivalents gets NO public-read policy at
-- all. Read/write is scoped to `client_admin`/`ne_admin` only — tighter than
-- `webhook_deliveries`' policy (open to any authenticated user of the
-- client), because these are the actual secrets/URLs that let someone
-- silently trigger a rebuild or forge a signed webhook payload, whereas
-- `webhook_deliveries` is just an observability log of the *outcomes*.

CREATE TABLE IF NOT EXISTS public.client_publish_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID UNIQUE NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  deploy_hook       TEXT,
  revalidate_url    TEXT,
  revalidate_secret TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.client_publish_config ENABLE ROW LEVEL SECURITY;

-- Reuses the same trigger function `handle_updated_at()` from migration 001.
CREATE OR REPLACE TRIGGER client_publish_config_updated_at
  BEFORE UPDATE ON public.client_publish_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Manage (SELECT/INSERT/UPDATE/DELETE): ne_admin (any client), or
-- client_admin scoped to their own client. Plain `editor` cannot read or
-- write this table at all — mirrors `api_keys_manage` (migration 004)
-- exactly, since these are bearer-secret-equivalent, not ordinary editorial
-- content.
CREATE POLICY "client_publish_config_manage" ON public.client_publish_config
  FOR ALL
  USING (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'client_admin'
      )
    )
  )
  WITH CHECK (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'client_admin'
      )
    )
  );

-- NOTE: intentionally no policy granting anonymous/public SELECT access, and
-- no policy allowing a plain `editor` role either — matching `api_keys`'s
-- precedent. The `/api/publish/notify` route and the `publish-scheduled`
-- cron both read this table via `createAdminClient()` (service role, bypasses
-- RLS), same as they already do for `webhook_deliveries`.

-- Migrate any existing data before dropping the source columns. Only rows
-- that actually have a value set get a row here, to avoid creating empty
-- `client_publish_config` rows for every client.
INSERT INTO public.client_publish_config (client_id, deploy_hook, revalidate_url, revalidate_secret)
SELECT id, deploy_hook, revalidate_url, revalidate_secret
FROM public.clients
WHERE deploy_hook IS NOT NULL OR revalidate_url IS NOT NULL OR revalidate_secret IS NOT NULL;

ALTER TABLE public.clients
  DROP COLUMN deploy_hook,
  DROP COLUMN revalidate_url,
  DROP COLUMN revalidate_secret;
