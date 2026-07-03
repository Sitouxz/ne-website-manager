import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveApiAccess, type ApiAuthClient } from '@/lib/api/auth';

/**
 * Public single-item endpoint for a `storage='generic'` collection entry
 * (`/api/client/[slug]/collections/[collection]/[itemSlug]`). Task 4.4.
 *
 * Uses the service-role client for the same reasons as the sibling list
 * route (`../route.ts`): verifying a presented API key (`api_keys`) and a
 * presented preview token (`preview_tokens`) both require bypassing RLS,
 * since neither table grants an anonymous caller any SELECT access at all.
 * Visibility is therefore re-implemented explicitly below rather than
 * relying on RLS.
 *
 * A non-published item is visible only if:
 *  - the caller presents a valid, unrevoked API key scoped to this client
 *    (`resolveApiAccess` returns `'keyed'`), or
 *  - the caller presents a `?preview_token=` query param that matches an
 *    unexpired row in `preview_tokens` for
 *    `entity_type: 'collection_entry'`, `entity_id: <this item's id>`.
 *    (`preview_token` was chosen over the shorter `token` used by the
 *    unrelated `/api/preview` draft-mode route on client sites, to avoid
 *    implying this is the same mechanism — that route sets Next.js draft
 *    mode cookies; this one only affects whether this one JSON response is
 *    returned.)
 *
 * Otherwise the item 404s — never 403 — so a public GET for something the
 * caller can't see looks indistinguishable from it not existing at all,
 * matching the 404-vs-403 reasoning already established for the revisions
 * route (`src/app/api/cms/revisions/route.ts`).
 */

function notFound(message = 'Not found') {
  return NextResponse.json({ error: message }, { status: 404 });
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; collection: string; itemSlug: string }> }
) {
  const { slug, collection: collectionSlug, itemSlug } = await params;
  const admin = createAdminClient();
  const url = new URL(req.url);

  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .single();

  if (!client) return notFound('Client not found');

  const { data: collection } = await admin
    .from('collections')
    .select('*')
    .eq('client_id', client.id)
    .eq('slug', collectionSlug)
    .single();

  if (!collection || collection.storage !== 'generic') return notFound('Collection not found');

  const { data: item } = await admin
    .from('collection_items')
    .select('*')
    .eq('collection_id', collection.id)
    .eq('client_id', client.id)
    .eq('slug', itemSlug)
    .single();

  if (!item) return notFound('Item not found');

  if (item.status !== 'published') {
    // See the sibling list route (`../route.ts`) for why this cast is
    // needed: `admin`'s real `SupabaseClient` type is too deep for TS to
    // structurally check against `ApiAuthClient` (TS2589).
    const access = await resolveApiAccess(req, slug, admin as unknown as ApiAuthClient);

    let visible = access.level === 'keyed';

    if (!visible) {
      const presentedToken = url.searchParams.get('preview_token');
      if (presentedToken) {
        const { data: previewToken } = await admin
          .from('preview_tokens')
          .select('*')
          .eq('client_id', client.id)
          .eq('entity_type', 'collection_entry')
          .eq('entity_id', item.id)
          .eq('token', presentedToken)
          .single();

        if (previewToken && new Date(previewToken.expires_at as string) > new Date()) {
          visible = true;
        }
      }
    }

    if (!visible) return notFound('Item not found');
  }

  const shaped = {
    id: item.id,
    slug: item.slug,
    data: item.data,
    published_at: item.published_at,
    updated_at: item.updated_at,
  };

  return NextResponse.json(shaped, { headers: CORS_HEADERS });
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
