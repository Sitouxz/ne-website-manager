-- Content Releases: publish a set of changes together, or not at all.
--
-- ## The problem this solves
--
-- Scheduling is per-entity today: `scheduled_at` on one post, one page, one
-- entry, flipped by `/api/cron/publish-scheduled` every five minutes. That
-- is correct for one article and wrong for a campaign. A Ramadan launch is
-- a schedule entry, a homepage banner global, a nav item and three posts,
-- and scheduling them individually means five rows becoming live in
-- whatever order the cron happens to select them, each firing its own
-- revalidation. The window between the first and last is a half-published
-- website — the "silently stale site found by the client" failure the
-- multi-tenancy plan already names, arrived at from a different direction.
--
-- A release is the missing noun: a named set, previewed as a set, published
-- as a set, with ONE revalidation at the end instead of one per row.
--
-- ## Shape
--
-- `release_id` is a nullable FK on each publishable table rather than a
-- join table. Content belongs to at most one release, the cron's existing
-- "what is due" query gains a single join, and every existing query is
-- untouched — a NULL `release_id` is exactly today's behaviour, so nothing
-- that does not opt in changes at all.
--
-- ## RLS posture
--
-- Per the Phase 5 rule: a release acts on content only when a human presses
-- publish (or when its scheduled time arrives, which a human set), so
-- authenticated write for the caller's own client is the right bar for
-- creating and editing one — the same bar as scheduling a post today.
-- Membership changes are likewise ordinary content edits.
--
-- The one thing NOT gated here is the act of publishing a release: that
-- runs server-side through the cron or the publish route using the admin
-- client, exactly as scheduled publishing already does, and is subject to
-- the same `015`/`016` reasoning about who may elevate content status. This
-- migration deliberately adds no policy that would let a client-side call
-- flip a release to `published` directly.

CREATE TABLE IF NOT EXISTS public.releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  -- 'draft'      — being assembled, nothing scheduled
  -- 'scheduled'  — `scheduled_at` set and in the future; the cron will take it
  -- 'published'  — every member flipped live in one pass
  -- 'cancelled'  — abandoned; members are released back to normal handling
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','scheduled','published','cancelled')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A scheduled release without a time would never fire and would sit in
  -- the list looking armed. Enforced here rather than in the UI because the
  -- cron's correctness depends on it.
  CONSTRAINT releases_scheduled_needs_time
    CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS releases_client_status_idx
  ON public.releases (client_id, status);

-- The cron's hot path: due, scheduled releases across every client.
CREATE INDEX IF NOT EXISTS releases_due_idx
  ON public.releases (scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "releases_select" ON public.releases
  FOR SELECT USING (client_id = my_client_id() OR is_ne_admin());

CREATE POLICY "releases_insert" ON public.releases
  FOR INSERT WITH CHECK (client_id = my_client_id() OR is_ne_admin());

CREATE POLICY "releases_update" ON public.releases
  FOR UPDATE USING (client_id = my_client_id() OR is_ne_admin());

CREATE POLICY "releases_delete" ON public.releases
  FOR DELETE USING (client_id = my_client_id() OR is_ne_admin());

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, never CASCADE: deleting a release must release its
-- content, never destroy it. A cancelled campaign is a scheduling decision,
-- and losing three posts because someone tidied up a release would be the
-- worst possible reading of that action.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS release_id UUID REFERENCES public.releases(id) ON DELETE SET NULL;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS release_id UUID REFERENCES public.releases(id) ON DELETE SET NULL;

ALTER TABLE public.collection_items
  ADD COLUMN IF NOT EXISTS release_id UUID REFERENCES public.releases(id) ON DELETE SET NULL;

-- Partial indexes: the overwhelming majority of rows have no release, and
-- every query that reads this column is asking "what is in release X".
CREATE INDEX IF NOT EXISTS posts_release_idx
  ON public.posts (release_id) WHERE release_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pages_release_idx
  ON public.pages (release_id) WHERE release_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS collection_items_release_idx
  ON public.collection_items (release_id) WHERE release_id IS NOT NULL;
