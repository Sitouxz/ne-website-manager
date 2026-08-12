-- =============================================================
-- `posts.cover_alt` — a description for the post's cover image.
--
-- `posts.cover_url` has existed since migration 001 with nowhere to put a
-- description, so the post editor rendered the cover with a hardcoded
-- `alt=""` and every client site that used the cover had nothing to render
-- either. `properties` already got this right (`hero_url` + `hero_alt`), and
-- generic collections get it through the `image` field type's `{ url, alt }`
-- shape — posts were the odd one out.
--
-- Nullable with no default and no backfill: an existing post genuinely has no
-- description for its cover, and inventing one (the title, say) would produce
-- confidently wrong alt text, which is worse for a screen reader user than
-- none. The publish preflight (`src/lib/publish-checks.ts`) asks for it at the
-- point someone is looking at the post anyway.
--
-- No RLS change: `posts` policies are column-agnostic.
-- =============================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS cover_alt TEXT;

COMMENT ON COLUMN public.posts.cover_alt IS
  'Description of cover_url for screen readers and search engines. Null means undescribed; do not substitute the title.';
