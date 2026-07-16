import { createClient } from '@/lib/supabase/server';
import { generateApiKey } from '@/lib/api/auth';
import { NextResponse } from 'next/server';

/**
 * CRUD for per-client API keys, backed by `public.api_keys` (migration
 * 004). Gated to `ne_admin` (any client) and `client_admin` (their own
 * client only) — plain `editor` accounts get 403 from every method here.
 * RLS on `api_keys` (see the migration) enforces the same rule as a
 * backstop; the checks below just produce a clean 403 instead of a
 * silent empty result from a blocked RLS read/write.
 */

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

function canManage(profile: CallerProfile | null, targetClientId: string): boolean {
  if (!profile) return false;
  if (profile.role === 'ne_admin') return true;
  return profile.role === 'client_admin' && profile.client_id === targetClientId;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { profile } = await loadCaller(supabase);

  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  }
  if (!canManage(profile, clientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.client_id;
  const name: string = typeof body.name === 'string' ? body.name.trim() : '';

  if (!clientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  }
  if (!canManage(profile, clientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { plaintext, prefix, keyHash } = generateApiKey();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      client_id: clientId,
      name: name || 'Untitled key',
      prefix,
      key_hash: keyHash,
      created_by: user.id,
    })
    .select('id, name, prefix, scopes, created_at, last_used_at, revoked_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // `plaintext` is returned exactly once here and is never persisted or logged.
  return NextResponse.json({ ...data, plaintext });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { profile } = await loadCaller(supabase);

  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // This SELECT runs on the user-scoped client, so `api_keys_manage` RLS
  // (migration 004: `is_ne_admin() OR (client_id = my_client_id() AND
  // caller is client_admin)`) already makes a cross-tenant row invisible
  // at the database level — against the real database, a client_admin
  // targeting another client's key gets `existing === null` here, i.e.
  // 404, not 403. The `canManage()` check below is a second layer, not
  // the primary gate: it only fires when a row *was* returned despite
  // belonging to another client, which shouldn't happen under RLS but
  // guards against this route ever being called with a client whose
  // visibility is broader than intended. See route.test.ts for tests
  // covering both the RLS-hidden (404) and defense-in-depth (403) cases.
  const { data: existing } = await supabase
    .from('api_keys')
    .select('id, client_id')
    .eq('id', id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }
  if (!canManage(profile, existing.client_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
