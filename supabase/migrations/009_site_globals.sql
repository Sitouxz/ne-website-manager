-- =============================================================
-- Site globals — Task 5.1 (Phase 5: Site Control).
--
-- `site_globals` stores small, key-value JSONB blobs of site-wide
-- settings that aren't tied to a single post/page/property: footer
-- copy + links, an announcement banner, free-form theme CSS-variable
-- overrides, social links, and contact info. One row per
-- (client_id, key) pair — `UNIQUE(client_id, key)` lets callers
-- upsert-by-key rather than tracking row ids.
--
-- Reserved `key` values and their `value` JSONB shapes (documented in
-- full alongside the TS contract in src/lib/globals/types.ts):
--   'footer'       -> { text: string; links: Array<{ label: string; href: string }> }
--   'announcement' -> { enabled: boolean; message: string; href?: string;
--                        variant: 'info' | 'success' | 'warning';
--                        starts_at?: string; ends_at?: string }
--   'theme'        -> { tokens: Record<string, string> }
--   'social'       -> Record<string, string>   (platform name -> URL)
--   'contact'      -> { email?: string; phone?: string; address?: string }
--
-- `key` is deliberately NOT constrained by a CHECK — new global keys can be
-- introduced without a migration, the same latitude `collections.fields`
-- and `collection_items.data` get for their own JSONB contracts.
--
-- RLS write policy mirrors `menu_items` (see
-- 007_document_existing_collections_schema.sql): broad `FOR ALL`
-- authenticated write scoped to the caller's own client (or ne_admin).
-- This is a deliberate judgment call, made after re-examining Task 4.2's
-- own review finding (which restricted `collections` writes to
-- ne_admin/client_admin — see 008_restrict_collections_writes.sql — because
-- collection *schemas* are structural/validation-affecting data that a
-- plain `editor` shouldn't be able to mutate). Site globals (footer text,
-- contact info, social links, announcement banner, theme tokens) are
-- everyday editorial content, not schema — closer in risk profile to
-- posts/pages (which any `editor` can already write) than to
-- `collections.fields`. The same reasoning is why `menu_items_authenticated`
-- (confirmed still broad/unrestricted via a live query against
-- pg_policies before writing this migration) is deliberately left
-- unchanged rather than tightened alongside this migration — full
-- reasoning in task-5.1-report.md.
--
-- Public read has no row-level condition (`USING (true)`) — every reserved
-- key's value is meant to be publicly fetchable by a client's website,
-- including a *disabled* announcement (`enabled: false`), so the website
-- can render nothing rather than being unable to distinguish "no
-- announcement configured" from "network/permission error". This differs
-- from `menu_items_public_read`, which filters on `is_visible` at the row
-- level because individual *nav items* can be hidden while others stay
-- visible; `site_globals` has no per-row visibility concept — a row either
-- exists for a client or it doesn't, and its shape encodes any "disabled"
-- state internally (e.g. `announcement.enabled`).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.site_globals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, key)
);

CREATE INDEX IF NOT EXISTS site_globals_client_idx ON public.site_globals (client_id);

ALTER TABLE public.site_globals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_globals_authenticated" ON public.site_globals;
CREATE POLICY "site_globals_authenticated" ON public.site_globals
  FOR ALL USING (client_id = my_client_id() OR is_ne_admin())
  WITH CHECK (client_id = my_client_id() OR is_ne_admin());

DROP POLICY IF EXISTS "site_globals_public_read" ON public.site_globals;
CREATE POLICY "site_globals_public_read" ON public.site_globals
  FOR SELECT USING (true);

CREATE OR REPLACE TRIGGER site_globals_updated_at
  BEFORE UPDATE ON public.site_globals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
