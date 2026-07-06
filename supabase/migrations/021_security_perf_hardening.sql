-- Post-Phase-8 audit hardening: fixes Supabase advisor findings that
-- surfaced after the full 8-phase CMS upgrade shipped. No behavior change
-- for any legitimate caller — see docs/superpowers/plans (Phase 8 audit) for
-- the reasoning behind each item.

-- 1. Pin search_path on functions that didn't already have it (advisor:
--    function_search_path_mutable). handle_new_user, prevent_profile_self_escalation,
--    and prevent_unauthorized_unpublish already had search_path=public set.
alter function public.handle_updated_at() set search_path = public;
alter function public.my_client_id() set search_path = public;
alter function public.is_ne_admin() set search_path = public;

-- 2. Trigger-only functions have no legitimate direct-RPC caller. Revoking
--    EXECUTE from anon/authenticated doesn't affect trigger firing (triggers
--    invoke the function directly, independent of the invoking role's
--    function-level privileges).
-- Functions are created with an implicit EXECUTE grant to PUBLIC, which
-- anon/authenticated inherit — revoking from the named roles alone doesn't
-- remove it, so PUBLIC must be revoked explicitly too.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.prevent_profile_self_escalation() from anon, authenticated, public;
revoke execute on function public.prevent_unauthorized_unpublish() from anon, authenticated, public;

-- 3. media_storage_public_read allowed listing/enumerating every object in
--    the public `media` bucket (any client's filenames), not just fetching a
--    known URL. The app never calls storage `.list()` or queries
--    `storage.objects` directly (Media Library reads from `public.media`;
--    files are served via `getPublicUrl`, which bypasses this RLS entirely
--    for a public=true bucket). Dropping this policy removes only the
--    enumeration ability.
drop policy if exists media_storage_public_read on storage.objects;

-- 4. auth_rls_initplan: wrap auth.uid()/my_client_id()/is_ne_admin() calls in
--    a scalar subselect so Postgres evaluates them once per statement
--    instead of once per row. Pure performance change — policy logic is
--    otherwise identical to the existing definitions.

alter policy api_keys_manage on public.api_keys
  using (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  );

alter policy client_publish_config_manage on public.client_publish_config
  using (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  );

alter policy collections_write_admin_only on public.collections
  using (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  );

alter policy invitations_manage on public.invitations
  using (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'client_admin')
    )
  );

alter policy collection_items_authenticated on public.collection_items
  using ( client_id = (select my_client_id()) or (select is_ne_admin()) )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and (
        status <> 'published'
        or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = any (array['ne_admin','client_admin']))
      )
    )
  );

alter policy pages_authenticated on public.pages
  using ( client_id = (select my_client_id()) or (select is_ne_admin()) )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and (
        status <> 'published'
        or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = any (array['ne_admin','client_admin']))
      )
    )
  );

alter policy posts_authenticated on public.posts
  using ( client_id = (select my_client_id()) or (select is_ne_admin()) )
  with check (
    (select is_ne_admin()) or (
      client_id = (select my_client_id())
      and (
        status <> all (array['published','scheduled'])
        or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = any (array['ne_admin','client_admin']))
      )
    )
  );

alter policy profiles_client_admin_manage on public.profiles
  using (
    client_id = (select my_client_id())
    and exists (select 1 from profiles p where p.id = (select auth.uid()) and p.role = 'client_admin')
  );

alter policy profiles_insert on public.profiles
  with check ( id = (select auth.uid()) );

alter policy profiles_select on public.profiles
  using ( id = (select auth.uid()) or (select is_ne_admin()) );

alter policy profiles_update on public.profiles
  using ( id = (select auth.uid()) );

-- 5. unindexed_foreign_keys: add covering indexes so FK joins/cascades don't
--    force a sequential scan as these tables grow.
create index if not exists activity_log_actor_id_idx on public.activity_log (actor_id);
create index if not exists api_keys_created_by_idx on public.api_keys (created_by);
create index if not exists invitations_invited_by_idx on public.invitations (invited_by);
create index if not exists media_client_id_idx on public.media (client_id);
create index if not exists media_uploaded_by_idx on public.media (uploaded_by);
create index if not exists menu_items_parent_id_idx on public.menu_items (parent_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists preview_tokens_client_id_idx on public.preview_tokens (client_id);
create index if not exists profiles_client_id_idx on public.profiles (client_id);
create index if not exists revisions_author_id_idx on public.revisions (author_id);
create index if not exists revisions_client_id_idx on public.revisions (client_id);
