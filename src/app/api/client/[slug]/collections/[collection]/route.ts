import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveApiAccess, type ApiAuthClient } from '@/lib/api/auth';
import { parsePagination } from '@/lib/api/pagination';

/**
 * Public list endpoint for a `storage='generic'` collection's items
 * (`/api/client/[slug]/collections/[collection]`). Task 4.4.
 *
 * Uses the service-role (`createAdminClient()`) client rather than the
 * user-scoped one, for two reasons:
 *  - `resolveApiAccess` needs to read `api_keys`, which has no RLS policy
 *    granting anonymous SELECT at all (by design, migration 004) — an
 *    unauthenticated caller verifying a presented key needs a service-role
 *    client or every request would silently resolve to `'public'`.
 *  - Once already holding an admin client for that lookup, this route reuses
 *    it for the `collections`/`collection_items` queries too, rather than
 *    juggling two clients. Because this bypasses RLS entirely, the
 *    visibility filtering RLS would otherwise have enforced for an anon
 *    caller (`collection_items_public_read`: `status = 'published'`) is
 *    re-implemented explicitly below.
 *
 * Judgment call — keyed access sees ALL statuses on this list endpoint:
 * `resolveApiAccess` was built in Task 1.3 but deliberately never wired into
 * any route until now, so there's no prior-art convention to follow for how
 * a `'keyed'` caller should see drafts on a *list*. A valid API key is
 * scoped to exactly one client, so a caller presenting one is reasonably
 * treated as a trusted, first-party consumer of that client's data — they
 * see every status (`draft`/`published`/`archived`), not just `published`.
 * This mirrors how the single-item route (Task 4.4 sibling) treats `'keyed'`
 * access as full visibility for that one item.
 */

const PAGINATION = { defaultLimit: 100, maxLimit: 100 };

function notFound() {
  return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; collection: string }> }
) {
  const { slug, collection: collectionSlug } = await params;
  const admin = createAdminClient();
  const url = new URL(req.url);

  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) return notFound();

  // Scoping the lookup to this client's id naturally excludes global
  // (`client_id IS NULL`) collections — they can never match here. The
  // `storage !== 'generic'` check separately rejects `native` collections,
  // which this route doesn't support (per the brief).
  const { data: collection } = await admin
    .from('collections')
    .select('*')
    .eq('client_id', client.id)
    .eq('slug', collectionSlug)
    .single();

  if (!collection || collection.storage !== 'generic') return notFound();

  // Cast rather than rely on structural inference: `admin`'s full
  // `SupabaseClient<any, ...>` type is deep enough that TS's structural
  // compatibility check against `ApiAuthClient` blows its instantiation
  // depth limit (TS2589). The cast is safe — `ApiAuthClient` is a narrow
  // subset of the real client's shape that `resolveApiAccess` actually uses.
  const access = await resolveApiAccess(req, slug, admin as unknown as ApiAuthClient);

  const sortParam = url.searchParams.get('sort');
  const sortColumn = sortParam === 'published_at' ? 'published_at' : 'sort_order';
  // sort_order (default) is a manually-curated ordering, so ascending is the
  // natural reading order; published_at mirrors the posts/pages/properties
  // routes' newest-first convention.
  const ascending = sortColumn === 'sort_order';

  const { limit, offset } = parsePagination(url, PAGINATION);

  let query = admin
    .from('collection_items')
    .select('*')
    .eq('collection_id', collection.id)
    .eq('client_id', client.id);

  let countQuery = admin
    .from('collection_items')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', collection.id)
    .eq('client_id', client.id);

  if (access.level !== 'keyed') {
    query = query.eq('status', 'published');
    countQuery = countQuery.eq('status', 'published');
  }

  // Status filtering must be applied before order/range (rather than after,
  // as posts/pages/properties happen to write it) — this in-memory test
  // double truncates eagerly on `.range()`, so a filter chained afterward
  // would filter an already-truncated page instead of the full matching set.
  // Real Postgrest builds the whole query before executing, so this ordering
  // is also correct (and clearer) against the live database.
  query = query.order(sortColumn, { ascending }).range(offset, offset + limit - 1);

  const [{ data: items, error }, { count }] = await Promise.all([query, countQuery]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = (items ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    slug: row.slug,
    data: row.data,
    published_at: row.published_at,
    updated_at: row.updated_at,
  }));

  return NextResponse.json(shaped, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'X-Total-Count': String(count ?? 0),
    },
  });
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
