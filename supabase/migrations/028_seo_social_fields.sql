-- =============================================================
-- Social image, canonical URL and "hide from search engines" on posts and
-- pages.
--
-- `seo_title` / `seo_description` only cover the Google result. A link
-- shared on WhatsApp, LinkedIn or Facebook reads Open Graph tags, and the
-- client sites had nothing to put in them beyond the post cover (pages had
-- nothing at all). Canonical and noindex are the two controls an operator
-- reaches for when a page is duplicated elsewhere or should not be indexed
-- (thank-you pages, campaign landers), and until now that meant a code
-- change on the client site.
--
--   - og_image_url:  nullable. Null means "fall back" — the post cover for
--                    posts, nothing for pages. The fallback is applied by the
--                    generated SDK's `toMetadata`, not stored, so changing a
--                    cover later still changes the share image.
--   - canonical_url: nullable. Null means the page's own URL.
--   - noindex:       NOT NULL DEFAULT false, so every existing row keeps
--                    today's behaviour (indexable). The public sitemap
--                    (`api/client/[slug]/seo`) leaves `noindex` rows out.
--
-- No RLS change: posts/pages policies are column-agnostic, and none of these
-- columns affects who can read or publish a row.
-- =============================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS og_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS noindex       BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS og_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS noindex       BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.posts.og_image_url IS
  'Image shown when the post is shared. Null falls back to cover_url.';
COMMENT ON COLUMN public.posts.canonical_url IS
  'Absolute canonical URL. Null means the post''s own URL.';
COMMENT ON COLUMN public.posts.noindex IS
  'Ask search engines not to index this post. Excluded from the public sitemap.';
COMMENT ON COLUMN public.pages.og_image_url IS
  'Image shown when the page is shared. Null means no share image.';
COMMENT ON COLUMN public.pages.canonical_url IS
  'Absolute canonical URL. Null means the page''s own URL.';
COMMENT ON COLUMN public.pages.noindex IS
  'Ask search engines not to index this page. Excluded from the public sitemap.';
