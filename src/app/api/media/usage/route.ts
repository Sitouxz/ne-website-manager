import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  findEntryUsages,
  findPageUsages,
  findPostUsages,
  findPropertyUsages,
  type MediaUsage,
} from '@/lib/media/usage';

/**
 * `GET /api/media/usage?id=<media id>` — answers "where is this image used?"
 * so the Media Library can warn before a delete breaks a live page.
 *
 * Auth follows the same convention as `src/app/api/media/route.ts`: a signed-in
 * dashboard user, acting on their own `profiles.client_id`, or an `ne_admin`
 * who passes `client_id` explicitly. Unlike that route this one is read-only,
 * so it deliberately uses ONLY the user-scoped client — RLS already limits
 * every table below to the caller's own client, which means there is no way to
 * probe another tenant's content even if `client_id` is spoofed.
 *
 * Scanning strategy: rows are fetched per table (scoped by `client_id`, capped
 * by `SCAN_LIMIT`) and matched in JS by `lib/media/usage.ts`, rather than with
 * SQL `ilike '%url%'`. Content lives in four different shapes — an HTML string,
 * a Tiptap JSON document, a JSONB `data` bag, a `gallery` array — and a single
 * substring scan over the serialized row covers all of them uniformly. These
 * are brochure-scale sites (hundreds of rows, not millions); if a client ever
 * outgrows `SCAN_LIMIT` the honest fix is a `media_usages` join table
 * maintained on save, not a bigger scan. `truncated` in the response says when
 * that limit was hit, so the UI can soften its wording instead of claiming a
 * completeness it can't guarantee.
 */

const SCAN_LIMIT = 500;

interface CallerProfile {
  role: string | null;
  client_id: string | null;
}

export interface MediaUsageResponse {
  usages: MediaUsage[];
  /** True when any table hit `SCAN_LIMIT`, so the list may be incomplete. */
  truncated: boolean;
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .single();
  const profile = profileRow as CallerProfile | null;

  const url = new URL(req.url);
  const mediaId = url.searchParams.get('id');
  if (!mediaId) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const requestedClientId = url.searchParams.get('client_id');
  const clientId = profile?.role === 'ne_admin' ? requestedClientId : profile?.client_id ?? null;
  if (!clientId) {
    return NextResponse.json({ error: 'No client associated with this account' }, { status: 400 });
  }

  const { data: media } = await supabase
    .from('media')
    .select('url')
    .eq('id', mediaId)
    .single();
  if (!media?.url) return NextResponse.json({ error: 'Media not found' }, { status: 404 });

  const mediaUrl = media.url as string;
  const scan = (table: string, columns: string) =>
    supabase.from(table).select(columns).eq('client_id', clientId).limit(SCAN_LIMIT);

  const [posts, pages, properties, entries, collections] = await Promise.all([
    scan('posts', 'id, title, slug, status, cover_url, content, content_json'),
    scan('pages', 'id, title, path, status, visibility, content, content_json'),
    scan('properties', 'id, name, slug, status, hero_url, gallery, story, tour'),
    scan('collection_items', 'id, collection_id, slug, status, data'),
    supabase.from('collections').select('id, slug').eq('client_id', clientId),
  ]);

  const rows = <T,>(result: { data: unknown }): T[] => (Array.isArray(result.data) ? (result.data as T[]) : []);
  type Row = Record<string, unknown>;

  const collectionSlugById: Record<string, string> = {};
  for (const collection of rows<Row>(collections)) {
    collectionSlugById[String(collection.id)] = String(collection.slug ?? collection.id);
  }

  const usages: MediaUsage[] = [
    ...findPostUsages(rows<Row>(posts), mediaUrl),
    ...findPageUsages(rows<Row>(pages), mediaUrl),
    ...findPropertyUsages(rows<Row>(properties), mediaUrl),
    ...findEntryUsages(rows<Row>(entries), mediaUrl, collectionSlugById),
  ];

  const truncated = [posts, pages, properties, entries].some(
    (result) => rows<Row>(result).length >= SCAN_LIMIT
  );

  const body: MediaUsageResponse = { usages, truncated };
  return NextResponse.json(body);
}
