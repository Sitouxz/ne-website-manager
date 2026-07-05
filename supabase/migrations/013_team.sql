-- =============================================================
-- NE Website Manager — Team invitations (Task 6.1)
--
-- `invitations`: pending invites for a client to join as `client_admin`
-- or `editor`. Consumed by a server-side route running under the
-- service-role client (see src/app/api/team/accept-invite/route.ts) —
-- a freshly-invited user has no elevated role yet (handle_new_user
-- gives every new auth.users row a default `profiles` row with
-- role='editor', client_id=NULL, migration 001_initial_schema.sql),
-- so they cannot read their own invitation row through the
-- client_admin/ne_admin-scoped RLS below. That's intentional: this
-- table's RLS protects *management* (create/list/revoke by an admin),
-- not token consumption, which is a distinct, deliberately
-- privileged server-side operation.
--
-- `role` CHECK explicitly excludes 'ne_admin' — there is structurally
-- no way to invite someone as ne_admin through this table at all,
-- matching the brief's requirement that a client_admin cannot invite/
-- promote to ne_admin. This is enforced at the DB level, not just in
-- application code.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('client_admin','editor')),
  invited_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_client_idx ON public.invitations (client_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx  ON public.invitations (token);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Management (list/create/revoke/mark accepted): ne_admin (any client),
-- or client_admin scoped to their own client. Plain `editor` cannot
-- manage invitations at all. Reuses the `api_keys_manage` /
-- `collections_write_admin_only` pattern (migrations 004, 008) — this
-- table is schema/access-sensitive, not everyday editorial content.
CREATE POLICY "invitations_manage" ON public.invitations
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

-- Lets a client_admin change role / remove (clear client_id) for
-- profiles within their own client, needed by the team management UI.
-- ne_admin already bypasses all RLS via `profiles_select`/no matching
-- restriction — but there is no existing UPDATE policy granting a
-- client_admin write access to a *different* user's profile row
-- (only `profiles_update` USING (id = auth.uid()) exists, i.e.
-- self-only), so this is additive, not a narrowing of anything.
CREATE POLICY "profiles_client_admin_manage" ON public.profiles
  FOR UPDATE
  USING (
    client_id = my_client_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'client_admin'
    )
  );
