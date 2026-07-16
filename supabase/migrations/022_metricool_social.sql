-- Social (Metricool) integration — per-client brand mapping.
--
-- Metricool's API is authenticated at the ACCOUNT level with a userToken +
-- userId (Neu Entity's own Metricool account) which live server-side only as
-- env vars (METRICOOL_USER_TOKEN / METRICOOL_USER_ID) — never per-client, never
-- in the DB. What IS per-client is the Metricool "brand" id (blogId): each
-- client website maps to one Metricool brand.
--
-- That mapping is kept OFF the `clients` table on purpose: `clients` has an
-- unconditionally public-read RLS policy (`clients_public_read_active`, see
-- migrations 018/019), so anything on it is world-readable via the anon key.
-- The blogId is not a bearer secret, but there is no reason to leak every
-- client's Metricool brand id publicly — so this follows the exact precedent
-- of `client_publish_config` (migration 018) and `api_keys` (migration 004):
-- a dedicated table with NO public-read policy, managed only by ne_admin or
-- the owning client_admin.

CREATE TABLE IF NOT EXISTS public.client_social_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID UNIQUE NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metricool_blog_id     TEXT,
  metricool_brand_label TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.client_social_config ENABLE ROW LEVEL SECURITY;

-- Reuses the same trigger function `handle_updated_at()` from migration 001.
CREATE OR REPLACE TRIGGER client_social_config_updated_at
  BEFORE UPDATE ON public.client_social_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Manage (SELECT/INSERT/UPDATE/DELETE): ne_admin (any client), or client_admin
-- scoped to their own client. Mirrors `client_publish_config_manage`
-- (migration 018) exactly. Plain `editor` cannot read or write this table;
-- the /api/social route reads it via the session client (RLS-enforced) so an
-- editor simply sees the "not configured" state rather than another client's
-- brand id.
CREATE POLICY "client_social_config_manage" ON public.client_social_config
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

-- NOTE: intentionally no anonymous/public SELECT policy and no plain-`editor`
-- access — matching `client_publish_config` / `api_keys`.
