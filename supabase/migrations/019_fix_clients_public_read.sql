-- Fix for Task 7.1 Finding 2 (Important, pre-existing, unrelated to Task
-- 7.1's own changes): the checked-in migration 001 declares
-- `clients_public_read_active` as `FOR SELECT USING (is_active = true)`, but
-- the LIVE database's actual policy is named `clients_public_read` with
-- `USING (true)` — unconditional, no `is_active` check at all. This means a
-- deactivated client's remaining public columns (name/slug/website_url/plan/
-- is_active/timestamps, after migration 018 moved the secrets off this
-- table) stay fully publicly readable even when `is_active = false`,
-- defeating the apparent intent of that column. Predates this session
-- entirely; discovered only via this review.
--
-- Fix: drop the live (incorrectly-named, incorrectly-scoped) policy and
-- recreate it matching the documented original intent.

DROP POLICY IF EXISTS "clients_public_read" ON public.clients;
DROP POLICY IF EXISTS "clients_public_read_active" ON public.clients;

CREATE POLICY "clients_public_read_active" ON public.clients
  FOR SELECT USING (is_active = true);
