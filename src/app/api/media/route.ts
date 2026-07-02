import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parsePagination } from '@/lib/api/pagination';

/**
 * Media Library upload/list/delete endpoint, backed by the Storage bucket
 * `media` (migration 005) and the `public.media` table (migration 001).
 *
 * Auth: all three methods require a signed-in dashboard user
 * (`auth.getUser()`), matching the pattern in `src/app/api/keys/route.ts`.
 * A non-admin caller (`client_admin`/`editor`) always acts on their own
 * `profiles.client_id` — any `client_id` they pass is ignored. An
 * `ne_admin` has no client of their own, so they must pass `client_id`
 * explicitly (form field on POST, query param on GET).
 *
 * Privilege split: the user-scoped client (`createClient()`) is used for
 * the auth/role lookup and for the read-only GET listing (RLS already
 * scopes it correctly). The actual Storage upload/remove and the
 * media-table insert/delete go through the service-role client
 * (`createAdminClient()`), mirroring `create-client/route.ts` — this keeps
 * the authorization decision in one place (this route) instead of also
 * depending on Storage RLS policies matching it exactly.
 */

export interface MediaItem {
  id: string;
  client_id: string;
  url: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  alt: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXACT_MIME_TYPES = new Set(['video/mp4', 'application/pdf']);

// Listing defaults: media libraries can grow large, so (unlike the
// properties endpoint) there's no "unlimited by default" legacy behavior
// to preserve — cap the default page at a sane size from day one.
const PAGINATION = { defaultLimit: 50, maxLimit: 100 };

// `getPublicUrl()` on a public bucket always produces
// `${SUPABASE_URL}/storage/v1/object/public/media/<path>` — used in reverse
// on DELETE to recover the Storage object path from the stored `url`. The
// `media` table has no separate "path" column (it isn't part of the
// existing schema this task builds on), so the public URL is the only
// record of where the object lives; this parses it back out rather than
// changing the table shape.
const PUBLIC_URL_MARKER = '/object/public/media/';

interface CallerProfile {
  role: string | null;
  client_id: string | null;
}

async function loadCaller(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null as CallerProfile | null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, client_id')
    .eq('id', user.id)
    .single();

  return { user, profile: (profile as CallerProfile | null) };
}

/**
 * Resolves which client_id a request acts on: an ne_admin must supply one
 * explicitly (they have none of their own); everyone else is pinned to
 * their own `profiles.client_id` regardless of what they pass.
 */
function resolveClientId(
  profile: CallerProfile | null,
  requested: string | null
): { clientId: string } | { error: string } {
  if (profile?.role === 'ne_admin') {
    if (!requested) return { error: 'client_id is required for ne_admin' };
    return { clientId: requested };
  }
  if (!profile?.client_id) return { error: 'No client associated with this account' };
  return { clientId: profile.client_id };
}

/** Same rule `media_authenticated` RLS enforces: own client (any role), or ne_admin. */
function canAccess(profile: CallerProfile | null, targetClientId: string): boolean {
  if (!profile) return false;
  if (profile.role === 'ne_admin') return true;
  return profile.client_id === targetClientId;
}

function isAllowedMime(mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  return ALLOWED_EXACT_MIME_TYPES.has(mimeType);
}

/** Replaces anything outside `[a-zA-Z0-9._-]` with `_` — no `/` survives, so the
 * sanitized name can never introduce a path segment (no traversal, no
 * escaping the `{client_id}/{yyyy}/` prefix it's appended to). */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractStoragePath(url: string): string | null {
  const idx = url.indexOf(PUBLIC_URL_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + PUBLIC_URL_MARKER.length));
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const altRaw = form.get('alt');
  const alt = typeof altRaw === 'string' ? altRaw : '';

  const requestedClientId = form.get('client_id');
  const resolved = resolveClientId(
    profile,
    typeof requestedClientId === 'string' ? requestedClientId : null
  );
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { clientId } = resolved;

  // Validate before any Storage write is attempted.
  if (!isAllowedMime(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Allowed: images, video/mp4, application/pdf.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 25 MB limit (${file.size} bytes)` },
      { status: 400 }
    );
  }

  const year = new Date().getFullYear();
  const sanitized = sanitizeFilename(file.name);
  const path = `${clientId}/${year}/${crypto.randomUUID()}-${sanitized}`;

  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from('media')
    .upload(path, file, { contentType: file.type });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from('media').getPublicUrl(path);

  const { data: row, error: insertError } = await admin
    .from('media')
    .insert({
      client_id: clientId,
      url: publicUrl,
      filename: sanitized,
      mime_type: file.type,
      size_bytes: file.size,
      alt,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    // Best-effort cleanup so a failed insert doesn't leave an orphaned object.
    await admin.storage.from('media').remove([path]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(row as MediaItem);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const resolved = resolveClientId(profile, url.searchParams.get('client_id'));
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { clientId } = resolved;

  const type = url.searchParams.get('type');
  const { limit, offset } = parsePagination(url, PAGINATION);

  let query = supabase
    .from('media')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  let countQuery = supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId);

  if (type) {
    query = query.like('mime_type', `${type}/%`);
    countQuery = countQuery.like('mime_type', `${type}/%`);
  }

  const [{ data, error }, { count }] = await Promise.all([query, countQuery]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? [], {
    headers: { 'X-Total-Count': String(count ?? 0) },
  });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // This SELECT runs on the user-scoped client, so `media_authenticated`
  // RLS (migration 001: `client_id = my_client_id() OR is_ne_admin()`)
  // already makes a cross-tenant row invisible at the database level —
  // against the real database, a non-admin caller targeting another
  // client's row gets `existing === null` here, i.e. 404, not 403. The
  // `canAccess()` check below is a second layer, not the primary gate: it
  // only fires when a row *was* returned despite belonging to another
  // client, which shouldn't happen under RLS but guards against this
  // route ever being called with a client whose visibility is broader
  // than intended (e.g. a service-role client that bypasses RLS
  // entirely). See route.test.ts for tests covering both the RLS-hidden
  // (404) and defense-in-depth (403) cases.
  const { data: existing } = await supabase
    .from('media')
    .select('*')
    .eq('id', id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
  if (!canAccess(profile, existing.client_id as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();

  const path = extractStoragePath(existing.url as string);
  if (path) {
    const { error: removeError } = await admin.storage.from('media').remove([path]);
    // Storage cleanup is best-effort: a stale/unparseable URL or a
    // Storage-side hiccup shouldn't block deleting the DB row (that would
    // make an already-broken row permanently undeletable). Log for
    // visibility instead of failing the request.
    if (removeError) {
      console.error('media DELETE: failed to remove storage object', path, removeError);
    }
  }

  const { error: deleteError } = await admin.from('media').delete().eq('id', id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
