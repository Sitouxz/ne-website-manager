-- =============================================================
-- NE Website Manager — Prevent profile self-privilege-escalation
-- (Task 6.1 code review, Critical finding — closes a pre-existing gap)
--
-- `profiles_update` RLS (migration 001_initial_schema.sql) is
-- `FOR UPDATE USING (id = auth.uid())` with NO `WITH CHECK` clause at
-- all, and the `authenticated` Postgres role has unrestricted
-- column-level UPDATE grants on `profiles.role`/`profiles.client_id`.
-- Since `id = auth.uid()` is trivially true for a self-targeted
-- update, RLS alone lets ANY authenticated user (including a plain
-- `editor`) PATCH their own `role`/`client_id` directly via
-- PostgREST (`.../rest/v1/profiles?id=eq.<their-own-id>`), bypassing
-- every app-layer check this task built
-- (src/app/api/team/invite/route.ts's role whitelist,
-- src/app/api/team/members/route.ts's role-change guard) — those
-- only matter for callers going through the Next.js app.
--
-- This is pre-existing (not introduced by Task 6.1's diff), but this
-- task is what turns role/client_id into a first-class, actively
-- managed feature, so it must be closed now.
--
-- RLS policies cannot compare OLD vs NEW column values within a
-- single declarative USING/WITH CHECK expression — that requires a
-- trigger, which is why this is a BEFORE UPDATE trigger rather than a
-- WITH CHECK addition to profiles_update.
-- =============================================================

CREATE OR REPLACE FUNCTION public.prevent_profile_self_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- No-op for updates that don't touch role/client_id at all (e.g. a
  -- user updating their own full_name/avatar_url) — those remain
  -- fully self-service per profiles_update, unaffected by this trigger.
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    -- auth.role() = 'service_role' is how Supabase's admin/service-role
    -- client connects (src/lib/supabase/admin.ts's createAdminClient()),
    -- used by src/app/api/team/accept-invite/route.ts and
    -- src/app/api/team/members/route.ts for the actual role/client_id
    -- writes those routes perform after doing their own app-layer
    -- authorization. is_ne_admin() (migration 001) covers the case of
    -- an ne_admin acting through some future direct-RLS path.
    IF auth.role() = 'service_role' OR public.is_ne_admin() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only an ne_admin or the service role may change role or client_id on a profile';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER profiles_prevent_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();
