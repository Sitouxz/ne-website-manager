-- =============================================================
-- Restrict cross-origin `redirects.to_path` writes to ne_admin.
--
-- Review finding on Task 5.3 (SEO Manager): the previous
-- `redirects_authenticated` policy (011_seo.sql) was
--   FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
--   WITH CHECK (client_id = my_client_id() OR is_ne_admin())
-- which let ANY authenticated user of a client — including a plain
-- `editor` — INSERT/UPDATE a `redirects` row with an arbitrary
-- `to_path`, including an absolute URL to a completely different
-- domain (e.g. `to_path = 'https://attacker-controlled-site.com/phishing'`)
-- or a protocol-relative URL (`//evil.com`).
--
-- That migration's own header comment argued this was no worse than
-- existing broad-write surfaces (`pages.content`/`posts.content` can
-- embed an `<a href>`, `menu_items.url` can point the nav at an
-- external URL) and left it unvalidated as YAGNI. On reflection this
-- undersells how a redirect differs from those precedents: a redirect
-- fires silently and automatically the instant a browser requests the
-- matching `from_path` — a visitor following an old bookmark, a search
-- result, or an external backlink is transparently sent to `to_path`
-- with no visible anchor text or nav label to inspect first. This is
-- the textbook "unvalidated redirect" phishing pattern (OWASP), and it
-- warrants a tighter write rule than the nav-link/content precedents.
--
-- Fix: keep the same-origin, low-risk case (redirecting one page on
-- the client's own site to another, e.g. `/old-page` -> `/new-page`)
-- writable by any authenticated user scoped to their own client, same
-- as before — that's the common case and carries no cross-domain
-- risk. Additionally require, for non-ne_admin writers, that `to_path`
-- look like a same-origin relative path:
--   - must start with a single `/` (not `//`, which is a
--     protocol-relative URL — `//evil.com` resolves to
--     `https://evil.com` in a browser, an open-redirect vector just
--     like an absolute URL) — `to_path ~ '^/($|[^/])'` (the bare root
--     path `/` is explicitly allowed via the `$` alternative; the
--     empty string does not start with `/` at all and is rejected).
--   - must not begin with a URI scheme prefix (`^[a-zA-Z][a-zA-Z0-9+.-]*:`
--     — catches `http:`, `https:`, `javascript:`, `data:`, etc.) — kept
--     as a belt-and-suspenders check even though a scheme-prefixed
--     string can never also start with `/` at position 0.
--
-- Verified mentally against the review's test cases:
--   /about              -> starts with /, second char 'a' (not /) -> PASS
--   //evil.com          -> starts with /, second char '/' -> FAIL
--   https://evil.com    -> does not start with / -> FAIL
--   javascript:alert(1) -> does not start with / -> FAIL
--   /                   -> starts with /, nothing after (the `$`
--                          alternative) -> PASS (bare root path, a
--                          legitimate same-origin redirect target)
--   '' (empty string)   -> does not start with / -> FAIL
--
-- `is_ne_admin()` continues to bypass this check entirely (any
-- `to_path`, absolute or relative, for any client) — matches the
-- existing ne_admin-can-do-everything convention throughout this
-- codebase (e.g. 008_restrict_collections_writes.sql).
--
-- Scope of this fix is deliberately narrow: only the WITH CHECK clause
-- (which gates INSERT and the new-row image of UPDATE) is tightened.
-- USING (which gates SELECT/DELETE/the pre-image of UPDATE) is left as
-- `client_id = my_client_id() OR is_ne_admin()` — unchanged — so a
-- client user can still see and delete their own client's redirects
-- (including a pre-existing cross-origin one, e.g. set by an admin, or
-- fix it back to a same-origin path) without this migration touching
-- read/delete semantics at all. `redirects_public_read` is untouched —
-- public read access is fine and unrelated to this fix; the issue is
-- who can WRITE a cross-origin `to_path`, not who can read redirects.
-- =============================================================

DROP POLICY IF EXISTS "redirects_authenticated" ON public.redirects;

CREATE POLICY "redirects_authenticated" ON public.redirects
  FOR ALL
  USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (
    is_ne_admin()
    OR (
      client_id = my_client_id()
      AND to_path ~ '^/($|[^/])'
      AND to_path !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:'
    )
  );
