-- =============================================================
-- Forms & Leads — Task 5.2 (Phase 5: Site Control).
--
-- `forms` defines a submittable form's schema, reusing `FieldDef`/`FieldType`
-- exactly like `collections.fields` does (see src/lib/collections/types.ts
-- and src/lib/collections/validate.ts's `validateEntry`), plus a list of
-- notification emails and an anti-spam honeypot field name.
--
-- `form_submissions` stores each POST accepted by the public submission
-- route (`src/app/api/client/[slug]/forms/[formSlug]/route.ts`). `status`
-- starts at 'new' and moves through 'read'/'archived' via the CMS
-- submissions inbox, or lands directly at 'spam' when the honeypot field
-- catches a bot — spam submissions are still inserted (not silently
-- dropped), so staff can audit false positives from the inbox.
--
-- RLS:
--  - `forms`: public SELECT (`USING (true)`) — a client's website may need
--    to introspect a form's `fields`/`honeypot_field` to render the actual
--    submission form, and the task brief is explicit that "forms public-read"
--    applies regardless of whether the submission route itself strictly
--    needs it (it looks the row up server-side via the admin client either
--    way). Write access is broad authenticated, scoped to the caller's own
--    client (or ne_admin) — forms are everyday editorial/marketing content,
--    not schema-sensitive the way `collections.fields` is (see
--    008_restrict_collections_writes.sql for that tighter policy, and
--    009_site_globals.sql for the same "everyday content" reasoning applied
--    to site_globals/menu_items).
--  - `form_submissions`: authenticated read/write scoped normally
--    (`client_id = my_client_id() OR is_ne_admin()`), but deliberately NO
--    anon-insert (or anon-select) policy at all. The public submission route
--    inserts via the service-role admin client (bypassing RLS entirely) —
--    specifically so that route's own honeypot/rate-limit/validation logic
--    is the ONLY path a submission can take. A direct anon POST straight to
--    the Supabase REST API, bypassing this app's route, cannot insert a row
--    here — there is no policy that would allow it.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.forms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  fields         JSONB NOT NULL DEFAULT '[]'::jsonb,
  notify_emails  TEXT[] NOT NULL DEFAULT '{}',
  honeypot_field TEXT NOT NULL DEFAULT 'website',
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, slug)
);

CREATE INDEX IF NOT EXISTS forms_client_idx ON public.forms (client_id);

ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forms_authenticated" ON public.forms;
CREATE POLICY "forms_authenticated" ON public.forms
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "forms_public_read" ON public.forms;
CREATE POLICY "forms_public_read" ON public.forms
  FOR SELECT USING (true);

CREATE OR REPLACE TRIGGER forms_updated_at
  BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived', 'spam')),
  referrer   TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_submissions_form_idx ON public.form_submissions (form_id);
CREATE INDEX IF NOT EXISTS form_submissions_client_idx ON public.form_submissions (client_id);

ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_submissions_authenticated" ON public.form_submissions;
CREATE POLICY "form_submissions_authenticated" ON public.form_submissions
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

-- Deliberately NO anon-insert / anon-select policy on form_submissions — see
-- the file header. Every submission must go through the service-role admin
-- client in the public route, which enforces honeypot/rate-limit/validation
-- before ever touching this table.
