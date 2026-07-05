-- =============================================================
-- Task 6.2 (final finding) — Prevent unauthorized "downgrade from
-- live" on posts/pages/collection_items.
--
-- 015_publish_rls.sql's `WITH CHECK` only inspects the row as it will
-- exist *after* the write, so it correctly blocks a plain `editor`
-- from writing a row whose NEW status is elevated
-- (published/scheduled) — but it cannot see the row's OLD status, so
-- it does nothing to stop a write that REMOVES elevated status (sets
-- an already-published/scheduled row's status to
-- draft/in_review/archived). A plain `editor` who bypasses the
-- (already-disabled) UI and calls
-- `supabase.from('posts').update({ status: 'draft' })` directly
-- through their own authenticated session could unpublish
-- already-live content, undetected by RLS.
--
-- Same root cause and same fix shape as
-- 014_prevent_self_privilege_escalation.sql: RLS policies cannot
-- compare OLD vs NEW column values within a single declarative
-- USING/WITH CHECK expression — that requires a BEFORE UPDATE
-- trigger, which can see both.
--
-- One shared trigger function, parameterized by TG_TABLE_NAME (each
-- table's set of "elevated" status VALUES differs — see
-- 015_publish_rls.sql):
--   - posts:            elevated = status IN ('published','scheduled')
--   - pages:             elevated = status = 'published'
--   - collection_items:  elevated = status = 'published' only —
--                        'archived' itself is not a "live" status, so
--                        it is correctly not counted as elevated.
--                        IMPORTANT: this does NOT mean a
--                        published -> archived transition is excluded
--                        from the guard below — it is the opposite.
--                        Because 'archived' isn't elevated, a
--                        published -> archived write has
--                        was_elevated = true and still_elevated =
--                        false, so it hits the "elevated -> NOT
--                        elevated" guard exactly like published ->
--                        draft does, and is correctly BLOCKED for a
--                        non-admin (archiving an ALREADY-published row
--                        is a de-facto unpublish). Only archiving a
--                        row that was NOT already published (e.g.
--                        draft -> archived) is left untouched here,
--                        because OLD.status isn't elevated in that
--                        case to begin with.
--
-- This trigger ONLY intervenes on the specific transition
-- elevated -> NOT elevated:
--   - A same-status re-save of an elevated row (published -> published)
--     is untouched here — already governed by 015's WITH CHECK, which
--     requires ne_admin/client_admin for that case since NEW.status
--     stays elevated.
--   - An upgrade (draft -> published) is untouched here — also already
--     governed by 015's WITH CHECK.
--   - Any edit to a row that was never elevated to begin with
--     (draft -> draft, in_review -> draft, etc.) is untouched here —
--     OLD.status isn't elevated, so this trigger no-ops entirely.
--   - Only OLD elevated AND NEW not elevated hits the guard below.
--
-- Allow-check: `auth.role() = 'service_role' OR is_ne_admin()` alone
-- (014's pattern) is NOT sufficient here — unlike profiles'
-- role/client_id escalation (an ne_admin-only concern), 015's own
-- WITH CHECK deliberately allows BOTH `ne_admin` and `client_admin` to
-- set/hold elevated status (`is_ne_admin() OR EXISTS(... role IN
-- ('ne_admin','client_admin'))`). This trigger must allow the SAME two
-- roles to remove elevated status, or every client_admin's ability to
-- unpublish their own client's content would regress. Service-role
-- writes (the revision-restore route's admin-authorized path, any
-- future service-role-driven write) bypass RLS entirely already but
-- still fire BEFORE UPDATE triggers, so `auth.role() = 'service_role'`
-- is included explicitly, matching 014's own precedent.
-- =============================================================

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_unpublish()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  was_elevated BOOLEAN;
  still_elevated BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    was_elevated := OLD.status IN ('published', 'scheduled');
    still_elevated := NEW.status IN ('published', 'scheduled');
  ELSE
    -- pages, collection_items: only 'published' is elevated (see
    -- header comment above). For collection_items, 'archived' is not
    -- itself an elevated status, but a published -> archived
    -- transition still hits the guard below (was_elevated = true,
    -- still_elevated = false) and is correctly BLOCKED for a
    -- non-admin — it is NOT excluded from this trigger.
    was_elevated := OLD.status = 'published';
    still_elevated := NEW.status = 'published';
  END IF;

  -- Only the elevated -> not-elevated transition is this trigger's
  -- concern; everything else is left to 015's WITH CHECK (or is
  -- unrestricted, e.g. draft -> draft content edits).
  IF was_elevated AND NOT still_elevated THEN
    IF auth.role() = 'service_role' OR public.is_ne_admin() OR EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'client_admin'
    ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Only an admin can unpublish already-published content';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER posts_prevent_unauthorized_unpublish
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_unpublish();

CREATE OR REPLACE TRIGGER pages_prevent_unauthorized_unpublish
  BEFORE UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_unpublish();

CREATE OR REPLACE TRIGGER collection_items_prevent_unauthorized_unpublish
  BEFORE UPDATE ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_unpublish();
