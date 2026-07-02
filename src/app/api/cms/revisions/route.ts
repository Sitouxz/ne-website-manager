import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parsePagination } from '@/lib/api/pagination';

/**
 * Revision history: list + restore, backed by `public.revisions` (migration
 * 006). RLS (`client_id = my_client_id() OR is_ne_admin()`) already scopes
 * both GET and the lookups inside POST correctly through the user-scoped
 * `createClient()` — this route adds no further tenant checks beyond "is the
 * caller authenticated at all."
 *
 * Only `entity_type: 'post'` is wired end-to-end for Task 3.3 (the editor
 * this route serves). `page`/`property`/`collection_entry` are accepted by
 * the type (per the plan's forward-looking comment in migration 006) but
 * rejected with 400 here until a future phase actually restores them — YAGNI
 * beats speculative generalization.
 */

type EntityType = 'post' | 'page' | 'property' | 'collection_entry';

// Pagination: reused from the public list routes' `parsePagination` helper
// rather than a bare `.limit(50)` — this GET already has the same
// "?limit=&offset=" shape those routes support (a revision list can
// reasonably be paged through), so there's no reason to special-case it.
const PAGINATION = { defaultLimit: 50, maxLimit: 100 };

// The exact set of fields a revision `snapshot` carries for a `post` entity —
// matches the `payload` the post editor (`src/app/(app)/cms/posts/[id]/page.tsx`)
// writes to `posts` on every save/autosave. Restoring a revision re-applies
// exactly these fields onto the live row; anything else on the row (id,
// client_id, author_id, created_at, updated_at) is left untouched.
const POST_SNAPSHOT_FIELDS = [
  'title', 'slug', 'excerpt', 'content', 'content_json', 'category', 'tags',
  'status', 'cover_url', 'seo_title', 'seo_description', 'scheduled_at', 'published_at',
] as const;

function pickSnapshotFields(row: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of POST_SNAPSHOT_FIELDS) {
    if (field in row) snapshot[field] = row[field];
  }
  return snapshot;
}

/**
 * Resolves `author_id -> full_name` via the service-role client for display
 * purposes only. Necessary because `profiles` RLS (migration 001) only
 * lets a caller see their own profile row (`id = auth.uid()`) unless they're
 * `ne_admin` — so a plain user-scoped join would silently show "Unknown" for
 * every teammate's revision, which defeats the point of a history list. This
 * is a deliberate, narrow, read-only use of the admin client (exposing only
 * `full_name`, never anything else) to work around that RLS gap for
 * attribution display — not a tenant-scoping bypass, since the caller has
 * already been authenticated and the *rows themselves* are still resolved
 * through the user-scoped client above.
 */
async function resolveAuthorNames(authorIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = Array.from(new Set(authorIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', uniqueIds);

  const names: Record<string, string> = {};
  for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
    names[p.id] = p.full_name ?? 'Unknown';
  }
  return names;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entity_type and entity_id are required' }, { status: 400 });
  }

  const { limit, offset } = parsePagination(url, PAGINATION);

  const { data, error } = await supabase
    .from('revisions')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const names = await resolveAuthorNames(rows.map((r) => r.author_id as string));
  const enriched = rows.map((r) => ({
    ...r,
    author_name: r.author_id ? names[r.author_id as string] ?? 'Unknown' : 'Unknown',
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as
    | { entity_type?: EntityType; entity_id?: string; revision_id?: string }
    | null;

  const entityType = body?.entity_type;
  const entityId = body?.entity_id;
  const revisionId = body?.revision_id;

  if (!entityType || !entityId || !revisionId) {
    return NextResponse.json(
      { error: 'entity_type, entity_id, and revision_id are required' },
      { status: 400 }
    );
  }

  if (entityType !== 'post') {
    return NextResponse.json(
      { error: `Restoring "${entityType}" revisions is not yet supported` },
      { status: 400 }
    );
  }

  const { data: revision } = await supabase
    .from('revisions')
    .select('*')
    .eq('id', revisionId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .single();

  if (!revision) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });

  const { data: currentPost } = await supabase
    .from('posts')
    .select('*')
    .eq('id', entityId)
    .single();

  if (!currentPost) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  // Snapshot the pre-restore state first, so restoring is itself
  // non-destructively undoable (a second Restore click can always get back
  // to "right before this restore").
  await supabase.from('revisions').insert({
    client_id: currentPost.client_id,
    entity_type: 'post',
    entity_id: entityId,
    snapshot: pickSnapshotFields(currentPost as Record<string, unknown>),
    author_id: user.id,
  });

  const restoreFields = pickSnapshotFields(revision.snapshot as Record<string, unknown>);

  const { data: restored, error: updateError } = await supabase
    .from('posts')
    .update(restoreFields)
    .eq('id', entityId)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json(restored);
}
