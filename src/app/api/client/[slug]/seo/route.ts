import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Public SEO feed (Task 5.3) — `{ redirects, sitemap }` for a client's site
 * to consume at build/runtime: `redirects` so the site can apply legacy-path
 * -> new-path rewrites itself, `sitemap` so it can generate a `sitemap.xml`
 * (or drive an SEO audit) without re-deriving "what's publicly reachable"
 * logic of its own.
 *
 * Uses the service-role `createAdminClient()`, NOT the user-scoped
 * `createClient()` that `globals/route.ts` (Task 5.1) uses — unlike that
 * route, RLS alone can't satisfy every read this one needs:
 *  - `redirects_public_read`, `pages_public_read`, `posts_public_read`, and
 *    `collection_items_public_read` all grant `anon` exactly the rows this
 *    route wants (redirects: `USING (true)`; pages/posts/collection_items:
 *    `status = 'published'`, pages additionally `visibility = 'public'`).
 *  - BUT `collections` has no public-read policy for a client's own
 *    (`client_id` non-null) rows — only `collections_global_read` (`USING
 *    (client_id IS NULL)`, i.e. system/template collections). This route
 *    must look up a client's own generic collections (to build
 *    `/{collection.slug}/{item.slug}` paths and to exclude `native`
 *    collections), which an anon-scoped client cannot read at all. That
 *    single gap forces an admin client; once holding one, this route reuses
 *    it for every other query too rather than juggling two clients —
 *    the same call `collections/[collection]/route.ts` (Task 4.4) made for
 *    an analogous reason. Because this bypasses RLS entirely, every
 *    visibility rule RLS would otherwise have enforced (published-only,
 *    public-only, generic-only) is re-implemented explicitly below.
 *
 * --- Sitemap path-construction conventions (first task to fix these; see
 * task brief's note that path templates are "configurable later — YAGNI") ---
 *   - Pages:      `pages.path` verbatim — already a full path (e.g. `/about`).
 *   - Posts:      `/blog/{posts.slug}` — the literal prefix the brief specifies.
 *   - Collection entries: `/{collection.slug}/{item.slug}` — e.g. a "Sermons"
 *     collection (`slug: 'sermons'`) with an entry `slug: 'friday-sermon'`
 *     becomes `/sermons/friday-sermon`. PROVISIONAL: nothing else in this
 *     codebase fixes a collection entry's public URL shape, so this is a
 *     reasonable default, not a guaranteed match for how every client site
 *     actually routes its collections. If a future client needs a different
 *     shape (nested under a parent page, a different prefix, etc.), this is
 *     the place to make the template configurable — not now (YAGNI).
 *
 * Only PUBLISHED content is included, scoped like Phase 4 already scopes
 * collections: `storage = 'generic'` only (native collections are views over
 * posts/pages/properties, which are already represented directly in the
 * sitemap via their own tables — including them again via a native
 * collection would duplicate entries) and global/system collections
 * (`client_id IS NULL`) are excluded by construction (the `collections`
 * lookup below is scoped to `client_id = client.id`, which a global
 * collection's row never matches).
 */

interface SitemapEntry {
  path: string;
  updated_at: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [
    { data: redirectRows, error: redirectsError },
    { data: pageRows, error: pagesError },
    { data: postRows, error: postsError },
    { data: collectionRows, error: collectionsError },
  ] = await Promise.all([
    admin.from('redirects').select('from_path, to_path, permanent').eq('client_id', client.id),
    // `visibility = 'public'` is not literally spelled out in the brief's
    // "pages.status='published'" filter, but is applied here anyway to match
    // `pages_public_read`'s own RLS condition — a page an editor has flagged
    // `private` shouldn't surface in a *public* sitemap just because it also
    // happens to be published.
    admin.from('pages').select('path, updated_at').eq('client_id', client.id).eq('status', 'published').eq('visibility', 'public'),
    admin.from('posts').select('slug, updated_at').eq('client_id', client.id).eq('status', 'published'),
    admin.from('collections').select('id, slug').eq('client_id', client.id).eq('storage', 'generic'),
  ]);

  if (redirectsError) return NextResponse.json({ error: redirectsError.message }, { status: 500 });
  if (pagesError) return NextResponse.json({ error: pagesError.message }, { status: 500 });
  if (postsError) return NextResponse.json({ error: postsError.message }, { status: 500 });
  if (collectionsError) return NextResponse.json({ error: collectionsError.message }, { status: 500 });

  // Explicitly shaped (rather than returning the row as-is) so the response
  // contract is `{from_path, to_path, permanent}` regardless of what other
  // columns the underlying row happens to carry (id, client_id,
  // created_at/updated_at) — mirrors `collections/[collection]/route.ts`'s
  // own explicit re-shaping of `collection_items` rows.
  const redirects = (redirectRows ?? []).map((row: Record<string, unknown>) => ({
    from_path: row.from_path,
    to_path: row.to_path,
    permanent: row.permanent,
  }));

  const sitemap: SitemapEntry[] = [];

  for (const page of (pageRows ?? []) as { path: string; updated_at: string | null }[]) {
    sitemap.push({ path: page.path, updated_at: page.updated_at });
  }

  for (const post of (postRows ?? []) as { slug: string; updated_at: string | null }[]) {
    sitemap.push({ path: `/blog/${post.slug}`, updated_at: post.updated_at });
  }

  const genericCollections = (collectionRows ?? []) as { id: string; slug: string }[];
  if (genericCollections.length > 0) {
    const collectionIds = genericCollections.map((c) => c.id);
    const slugByCollectionId = new Map(genericCollections.map((c) => [c.id, c.slug]));

    const { data: itemRows, error: itemsError } = await admin
      .from('collection_items')
      .select('collection_id, slug, updated_at')
      .eq('client_id', client.id)
      .eq('status', 'published')
      .in('collection_id', collectionIds);

    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

    for (const item of (itemRows ?? []) as { collection_id: string; slug: string; updated_at: string | null }[]) {
      const collectionSlug = slugByCollectionId.get(item.collection_id);
      if (!collectionSlug) continue; // shouldn't happen — item scoped to a collection just queried above
      sitemap.push({ path: `/${collectionSlug}/${item.slug}`, updated_at: item.updated_at });
    }
  }

  return NextResponse.json(
    { redirects, sitemap },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
