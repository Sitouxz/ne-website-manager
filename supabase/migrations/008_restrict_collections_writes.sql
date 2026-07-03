-- =============================================================
-- Restrict `collections` writes to ne_admin / client_admin.
--
-- Review finding on Task 4.2 (collection schema builder): the previous
-- `collections_authenticated` policy was `FOR ALL USING (client_id =
-- my_client_id() OR is_ne_admin())`, which let ANY authenticated user
-- of a client — including plain `editor` — INSERT/UPDATE/DELETE
-- `collections` rows for their own client directly via the Supabase
-- client, bypassing the app-layer assumption (see
-- src/app/(app)/cms/collections/[id]/schema/page.tsx) that only
-- `ne_admin` can build/edit collection schemas.
--
-- Fix mirrors the existing `api_keys_manage` pattern from
-- 004_api_keys.sql: writes are restricted to `is_ne_admin()` (any
-- client) or `client_admin` scoped to their own client, explicitly
-- excluding plain `editor`. Reads are left unrestricted for any
-- authenticated user of the client, since the collections list page
-- is intentionally visible to all roles for their own client (a
-- separate, lower-risk finding this migration does not change).
--
-- RLS note: Postgres evaluates multiple permissive policies for the
-- same command as OR'd together. Splitting this into a SELECT policy
-- (broad) and a FOR ALL write policy (narrow) is safe rather than
-- reintroducing the problem: the write policy's condition
-- (is_ne_admin() OR client_admin-of-own-client) is a strict subset of
-- the read policy's condition (client_id = my_client_id() OR
-- is_ne_admin()), so OR-ing it into SELECT evaluation never widens
-- read access beyond what the dedicated read policy already grants.
-- For INSERT/UPDATE/DELETE, the read-only SELECT policy simply
-- doesn't apply (it's declared FOR SELECT), so the FOR ALL write
-- policy is the sole gate on those commands — correctly excluding
-- plain `editor`.
--
-- `collections_global_read` (client_id IS NULL SELECT policy) is
-- untouched — correct and unrelated to this fix. `collection_items`
-- and `menu_items` RLS are out of scope for this finding.
-- =============================================================

DROP POLICY IF EXISTS "collections_authenticated" ON public.collections;

-- Read: any authenticated user of the client (or ne_admin) may read
-- their client's collections. Preserves current read behavior.
CREATE POLICY "collections_select_authenticated" ON public.collections
  FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());

-- Write (INSERT/UPDATE/DELETE): ne_admin (any client), or client_admin
-- scoped to their own client. Plain `editor` cannot write at all.
CREATE POLICY "collections_write_admin_only" ON public.collections
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
