-- =============================================================
-- Trash: deleting a post, page, property or collection entry moves it here
-- instead of destroying it, and it can be restored for 30 days.
--
-- ## Why a separate table, not a `deleted_at` column
--
-- A `deleted_at` column would need `deleted_at IS NULL` added to every read
-- path that exists today and every one written later: the public post/page/
-- collection routes, the sitemap, the generated SDK's endpoints, preview,
-- the scheduled-publish cron, the health sweep, the MCP tools, dashboards,
-- media usage. Several of those use the service-role client and bypass RLS,
-- so one forgotten filter would quietly put deleted content back on a live
-- client website. Moving the row out of its table changes none of those
-- reads: a trashed post simply is not in `posts` any more.
--
-- The row is kept whole (`to_jsonb` of the row) so a restore re-creates it
-- with its original id. Revisions are keyed by that id, so history survives
-- a trash and restore untouched.
--
-- ## Who can do what
--
--   - Trash a draft:       anyone who can delete it today (RLS on the
--                          content table, unchanged).
--   - Trash live content:  admins only — see the delete guard below.
--   - Restore:             anyone in the client's workspace. A restore is an
--                          INSERT into the content table, so 015's WITH CHECK
--                          still applies: only an admin can restore a row
--                          that comes back published.
--   - Delete forever:      admins only (trigger on `trash`), plus the
--                          service-role purge cron after 30 days.
--
-- ## The delete guard (closes an existing gap)
--
-- 015/016 stop a plain `editor` from publishing or unpublishing, but both
-- only guard UPDATE. DELETE was unguarded, so an editor could take a live
-- post off the website by deleting it — the one way around the review
-- workflow. `prevent_unauthorized_live_delete` applies 016's rule to
-- DELETE: removing a row whose status is live (posts: published/scheduled;
-- pages, collection_items: published) needs client_admin, ne_admin or the
-- service role. Properties are not covered, matching the fact that no
-- existing policy gates property status either.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.trash (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('post', 'page', 'property', 'collection_entry')),
  entity_id   UUID NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  snapshot    JSONB NOT NULL,
  deleted_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trash_client_deleted_idx ON public.trash (client_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS trash_deleted_at_idx ON public.trash (deleted_at);

ALTER TABLE public.trash ENABLE ROW LEVEL SECURITY;

-- Same tenant scoping as the content tables. No UPDATE policy: a trash row
-- is written once and only ever restored (deleted) or purged.
CREATE POLICY "trash_select" ON public.trash
  FOR SELECT USING (client_id = (select my_client_id()) OR (select is_ne_admin()));

CREATE POLICY "trash_insert" ON public.trash
  FOR INSERT WITH CHECK (client_id = (select my_client_id()) OR (select is_ne_admin()));

-- DELETE is open to the workspace at the policy level because restoring is
-- a delete of the trash row; "delete forever" is narrowed to admins by the
-- trigger below, which can tell the two apart.
CREATE POLICY "trash_delete" ON public.trash
  FOR DELETE USING (client_id = (select my_client_id()) OR (select is_ne_admin()));

-- -------------------------------------------------------------
-- Helpers
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.caller_is_content_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'service_role'
    OR public.is_ne_admin()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'client_admin');
$$;

-- -------------------------------------------------------------
-- Delete guard on live content
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_live_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_live BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    is_live := OLD.status IN ('published', 'scheduled');
  ELSE
    is_live := OLD.status = 'published';
  END IF;

  IF is_live AND NOT public.caller_is_content_admin() THEN
    RAISE EXCEPTION 'Only an admin can delete content that is live on the website. Ask an admin to unpublish it first.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER posts_prevent_unauthorized_live_delete
  BEFORE DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_live_delete();

CREATE OR REPLACE TRIGGER pages_prevent_unauthorized_live_delete
  BEFORE DELETE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_live_delete();

CREATE OR REPLACE TRIGGER collection_items_prevent_unauthorized_live_delete
  BEFORE DELETE ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_live_delete();

-- -------------------------------------------------------------
-- "Delete forever" guard on trash
-- -------------------------------------------------------------

-- `restore_item` marks the one trash row it is about to remove with a
-- transaction-local setting; any other delete of a trash row is a permanent
-- purge and needs an admin (or the service-role cron). The setting cannot
-- be forged from PostgREST: `set_config` is not an exposed RPC, and each
-- RPC call is its own transaction, so a value can't carry over.
CREATE OR REPLACE FUNCTION public.guard_trash_purge()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('ne.restoring_trash_id', true) = OLD.id::text THEN
    RETURN OLD;
  END IF;

  IF NOT public.caller_is_content_admin() THEN
    RAISE EXCEPTION 'Only an admin can permanently delete items from the trash.'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trash_guard_purge
  BEFORE DELETE ON public.trash
  FOR EACH ROW EXECUTE FUNCTION public.guard_trash_purge();

-- -------------------------------------------------------------
-- trash_item / restore_item
-- -------------------------------------------------------------
-- Both are SECURITY INVOKER: every statement inside runs under the caller's
-- own RLS and fires the guards above, so neither function grants anything
-- the caller could not already do one statement at a time. They exist to
-- make the copy and the delete one transaction — a failure in either half
-- leaves nothing half-done.
--
-- The table is chosen from a fixed CASE, never interpolated from input.

CREATE OR REPLACE FUNCTION public.trash_item(p_entity_type TEXT, p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  snap     JSONB;
  label    TEXT;
  trash_id UUID;
  removed  INTEGER;
BEGIN
  CASE p_entity_type
    WHEN 'post' THEN
      SELECT to_jsonb(t) INTO snap FROM public.posts t WHERE t.id = p_id;
      label := snap->>'title';
    WHEN 'page' THEN
      SELECT to_jsonb(t) INTO snap FROM public.pages t WHERE t.id = p_id;
      label := snap->>'title';
    WHEN 'property' THEN
      SELECT to_jsonb(t) INTO snap FROM public.properties t WHERE t.id = p_id;
      label := snap->>'name';
    WHEN 'collection_entry' THEN
      SELECT to_jsonb(t) INTO snap FROM public.collection_items t WHERE t.id = p_id;
      label := COALESCE(NULLIF(snap->'data'->>'title', ''), NULLIF(snap->'data'->>'name', ''), snap->>'slug');
    ELSE
      RAISE EXCEPTION 'Unknown content type: %', p_entity_type USING ERRCODE = '22023';
  END CASE;

  IF snap IS NULL THEN
    RAISE EXCEPTION 'That item no longer exists, or you do not have access to it.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.trash (client_id, entity_type, entity_id, title, snapshot, deleted_by)
  VALUES ((snap->>'client_id')::uuid, p_entity_type, p_id, COALESCE(label, ''), snap, auth.uid())
  RETURNING id INTO trash_id;

  CASE p_entity_type
    WHEN 'post'             THEN DELETE FROM public.posts            WHERE id = p_id;
    WHEN 'page'             THEN DELETE FROM public.pages            WHERE id = p_id;
    WHEN 'property'         THEN DELETE FROM public.properties       WHERE id = p_id;
    WHEN 'collection_entry' THEN DELETE FROM public.collection_items WHERE id = p_id;
  END CASE;

  -- RLS filters a DELETE silently rather than raising; zero rows removed
  -- means the caller could read the row but not delete it, and the trash
  -- copy must not survive on its own.
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> 1 THEN
    RAISE EXCEPTION 'You do not have permission to delete this item.' USING ERRCODE = '42501';
  END IF;

  RETURN trash_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_item(p_trash_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  item     public.trash%ROWTYPE;
  snap     JSONB;
  restored JSONB;
BEGIN
  SELECT * INTO item FROM public.trash WHERE id = p_trash_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item is no longer in the trash.' USING ERRCODE = 'P0002';
  END IF;

  snap := item.snapshot;

  -- `jsonb_populate_record` fills keys missing from the snapshot with NULL.
  -- Every column exists in a snapshot taken by `trash_item`, so this only
  -- matters if a later migration adds a NOT NULL column to a content table:
  -- that migration must backfill it into `trash.snapshot` too, or restores
  -- of items trashed before it will fail on the constraint.

  -- A release the item belonged to may have been deleted since; the
  -- foreign key would reject the whole restore, so detach it instead.
  IF snap ? 'release_id' AND snap->>'release_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.releases WHERE id = (snap->>'release_id')::uuid) THEN
    snap := jsonb_set(snap, '{release_id}', 'null'::jsonb);
  END IF;

  BEGIN
    CASE item.entity_type
      WHEN 'post' THEN
        INSERT INTO public.posts SELECT * FROM jsonb_populate_record(NULL::public.posts, snap)
        RETURNING to_jsonb(posts.*) INTO restored;
      WHEN 'page' THEN
        INSERT INTO public.pages SELECT * FROM jsonb_populate_record(NULL::public.pages, snap)
        RETURNING to_jsonb(pages.*) INTO restored;
      WHEN 'property' THEN
        INSERT INTO public.properties SELECT * FROM jsonb_populate_record(NULL::public.properties, snap)
        RETURNING to_jsonb(properties.*) INTO restored;
      WHEN 'collection_entry' THEN
        INSERT INTO public.collection_items SELECT * FROM jsonb_populate_record(NULL::public.collection_items, snap)
        RETURNING to_jsonb(collection_items.*) INTO restored;
    END CASE;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Something else now uses this item''s web address. Rename or remove it, then restore again.'
        USING ERRCODE = '23505';
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'This item belonged to something that has since been deleted, so it cannot be restored.'
        USING ERRCODE = '23503';
  END;

  PERFORM set_config('ne.restoring_trash_id', p_trash_id::text, true);
  DELETE FROM public.trash WHERE id = p_trash_id;
  PERFORM set_config('ne.restoring_trash_id', '', true);

  RETURN restored;
END;
$$;

-- Trigger-only functions have no legitimate RPC caller (same posture as
-- 021). The two RPCs stay callable by signed-in users only.
REVOKE EXECUTE ON FUNCTION public.prevent_unauthorized_live_delete() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.guard_trash_purge() FROM anon, authenticated, public;
-- Only ever called from inside the SECURITY DEFINER triggers above.
REVOKE EXECUTE ON FUNCTION public.caller_is_content_admin() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trash_item(TEXT, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.restore_item(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.trash_item(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_item(UUID) TO authenticated;

COMMENT ON TABLE public.trash IS
  'Deleted posts, pages, properties and collection entries, kept whole for 30 days so they can be restored.';
