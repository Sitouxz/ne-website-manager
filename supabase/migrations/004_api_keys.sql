-- =============================================================
-- NE Website Manager — API Keys
-- Per-client keys for the public /api/client/[slug]/* endpoints.
-- Only a SHA-256 hash of the full key is ever stored — the plaintext
-- key is shown to the generating user exactly once, client-side.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  scopes        TEXT[] DEFAULT '{read}',
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(prefix)
);

CREATE INDEX IF NOT EXISTS api_keys_client_idx ON public.api_keys (client_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Management (list/generate/revoke): ne_admin (any client), or client_admin
-- scoped to their own client. Plain `editor` cannot manage keys at all.
-- Reuses `my_client_id()` / `is_ne_admin()` from migration 001.
CREATE POLICY "api_keys_manage" ON public.api_keys
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

-- NOTE: this table intentionally has no policy granting anonymous/public
-- SELECT access. Verifying a presented key from an unauthenticated public
-- route (resolveApiAccess in src/lib/api/auth.ts, wired up in a later
-- phase) will need to read this table with a service-role client
-- (see src/lib/supabase/admin.ts), since an anonymous caller has no
-- `auth.uid()` and this RLS policy would otherwise hide every row from it.
