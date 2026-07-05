-- =============================================================
-- Task 6.2 — Editorial review workflow: gate publishing via RLS.
--
-- Tightens the existing FOR ALL write policies on posts/pages/
-- collection_items (`USING (client_id = my_client_id() OR
-- is_ne_admin())`, no meaningful WITH CHECK — see 001_initial_schema.sql /
-- 007_document_existing_collections_schema.sql) by adding a WITH CHECK
-- clause so that once a row's *new* state (the one actually being
-- written) would be publicly visible, only ne_admin/client_admin can
-- write it at all — a plain `editor` cannot publish/schedule content,
-- full stop, matching the CMS UI's editorial-review intent.
--
-- Per-table condition, matched to each table's ACTUAL status enum (not
-- a single copy-pasted condition — the three tables differ, see
-- src/lib/supabase/types.ts):
--   - posts:            'draft'|'in_review'|'scheduled'|'published'|'archived'
--                        -> gated when status IN ('published','scheduled')
--   - pages:             'draft'|'published' only — no scheduled/in_review
--                        state exists for pages
--                        -> gated when status = 'published'
--   - collection_items:  'draft'|'published'|'archived' — no
--                        scheduled/in_review state exists here either
--                        -> gated when status = 'published' ONLY.
--                           'archived' is NOT gated by THIS policy's
--                           own WITH CHECK in isolation: for a row that
--                           is NOT currently published, archiving
--                           doesn't take anything live down, so no
--                           elevated role is required here — per the
--                           "does this action alone change what the
--                           public sees" posture rule from Phase 5's
--                           review. IMPORTANT — this is not the whole
--                           story for an ALREADY-published row: WITH
--                           CHECK can only inspect the NEW row, so it
--                           cannot by itself detect "this row used to
--                           be published." Archiving an
--                           ALREADY-published row IS a de-facto
--                           unpublish, and is separately (and
--                           correctly) blocked for a plain editor by
--                           016_prevent_unauthorized_unpublish.sql's
--                           elevated -> non-elevated transition
--                           trigger, which compares OLD vs NEW status
--                           (something this WITH CHECK cannot do on
--                           its own). Combined, practical behavior:
--                           editors can freely archive drafts, but
--                           archiving a live/published entry requires
--                           admin, same as any other unpublish. This
--                           table's condition matches pages' (status =
--                           'published'), not the broader posts one.
--
-- Deliberate, explicitly-confirmed side effect (not a bug, not
-- something to "fix" with a trigger): because Postgres RLS WITH CHECK
-- evaluates only against the NEW row on every UPDATE — it cannot
-- compare against the OLD row within a single policy, no trigger
-- involved here unlike 014_prevent_self_privilege_escalation.sql's
-- fix for a different problem — gating "who can publish" necessarily
-- gates "who can touch an already-published/scheduled row at all."
-- Once a row's status is published (or scheduled, for posts), only
-- ne_admin/client_admin can save ANY further edit to it, not just
-- re-toggle its status. This was confirmed with the user before this
-- phase began.
--
-- USING is left untouched on all three (still `client_id =
-- my_client_id() OR is_ne_admin()`) — this migration only narrows
-- INSERT/UPDATE via WITH CHECK; SELECT/DELETE visibility is unchanged
-- and out of scope for "who can publish."
-- =============================================================

ALTER POLICY "posts_authenticated" ON public.posts
  WITH CHECK (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND (
        status NOT IN ('published', 'scheduled')
        OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role IN ('ne_admin', 'client_admin')
        )
      )
    )
  );

ALTER POLICY "pages_authenticated" ON public.pages
  WITH CHECK (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND (
        status <> 'published'
        OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role IN ('ne_admin', 'client_admin')
        )
      )
    )
  );

ALTER POLICY "collection_items_authenticated" ON public.collection_items
  WITH CHECK (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND (
        status <> 'published'
        OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role IN ('ne_admin', 'client_admin')
        )
      )
    )
  );
