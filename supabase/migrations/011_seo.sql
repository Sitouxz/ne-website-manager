-- =============================================================
-- SEO Manager — Task 5.3 (Phase 5: Site Control).
--
-- `redirects` maps a legacy/removed `from_path` to a new `to_path` for a
-- client's site — one row per (client_id, from_path) pair
-- (`UNIQUE(client_id, from_path)` mirrors `site_globals`'s
-- `UNIQUE(client_id, key)`: lets a client site look up "is there a redirect
-- configured for the path I was just asked for" with a single indexed
-- lookup, and lets the CMS upsert-by-path rather than tracking row ids for
-- uniqueness). `permanent` distinguishes a 301 (default — most redirects are
-- permanent URL changes) from a 302 the client site should honor as
-- temporary.
--
-- RLS:
--  - Public SELECT (`USING (true)`) — a client's website needs to fetch its
--    own redirect list to actually apply them (see the public
--    `src/app/api/client/[slug]/seo/route.ts` this migration backs), the
--    same reasoning `site_globals_public_read`/`forms_public_read` already
--    established for other "the live site must be able to read this"
--    tables.
--  - Write: broad authenticated, scoped to the caller's own client (or
--    ne_admin) — `client_id = my_client_id() OR is_ne_admin()`, matching
--    `site_globals`/`forms`/`menu_items`'s "everyday editorial/operational
--    content" posture rather than `collections.fields`'s tighter
--    admin-only write (008_restrict_collections_writes.sql).
--
--    Judgment call, considered and rejected: redirects are more
--    security-sensitive on paper than footer text or a form's field list —
--    a malicious `to_path` could silently hijack traffic to an
--    attacker-controlled destination (e.g. an external phishing URL) if an
--    `editor`-role account were compromised or acted in bad faith. Two
--    things keep this in the same broad-write bucket as the rest of Phase
--    5 rather than escalating to a tighter policy:
--      1. Any `editor` can already achieve the same outcome today with
--         existing broad-write tables — `pages.content`/`posts.content` can
--         embed an `<a href="https://evil.example">`, and `menu_items.url`
--         (also editor-writable) can point the public nav itself at an
--         arbitrary external URL. `redirects.to_path` adds no new
--         capability an editor doesn't already have; it only adds a new
--         *shape* (whole-path redirect vs. an inline link) for the same
--         underlying risk this codebase has already accepted for content.
--      2. There is no schema/validation-integrity concern here analogous to
--         `collections.fields` (Task 4.2's tighter-write rationale) —
--         `to_path` is free text read by the client site's own redirect
--         logic, not structural metadata other rows depend on for
--         correctness.
--    `to_path` is deliberately NOT validated/constrained (no same-origin
--    check, no redirect-loop detection) — YAGNI per the brief; a relative
--    path or absolute external URL are both accepted as-is, exactly like
--    `menu_items.url` already accepts either today.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.redirects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  from_path  TEXT NOT NULL,
  to_path    TEXT NOT NULL,
  permanent  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, from_path)
);

CREATE INDEX IF NOT EXISTS redirects_client_idx ON public.redirects (client_id);

ALTER TABLE public.redirects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "redirects_authenticated" ON public.redirects;
CREATE POLICY "redirects_authenticated" ON public.redirects
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "redirects_public_read" ON public.redirects;
CREATE POLICY "redirects_public_read" ON public.redirects
  FOR SELECT USING (true);

CREATE OR REPLACE TRIGGER redirects_updated_at
  BEFORE UPDATE ON public.redirects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
