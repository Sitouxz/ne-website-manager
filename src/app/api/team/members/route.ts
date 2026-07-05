import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * Lists team members (profiles) for a client, including `last_sign_in_at`,
 * and lets a `client_admin`/`ne_admin` change a member's role or "remove"
 * them (clear `client_id`, per the brief — this never deletes the
 * `auth.users`/`profiles` row, matching `handle_new_user`'s nullable
 * `client_id`).
 *
 * Not explicitly listed in the task brief's file list, but necessary for
 * two reasons the brief's RLS spec doesn't cover on its own:
 *
 * 1. `last_sign_in_at` lives on `auth.users`, not `public.profiles` — only
 *    reachable via the admin API (`auth.admin.getUserById`), matching the
 *    brief's own note to "accept that this field may need to come from a
 *    privileged source."
 * 2. `profiles_select` RLS (migration 001) is `USING (id = auth.uid() OR
 *    is_ne_admin())` — a `client_admin` can only ever read their OWN
 *    profile row through it, never a teammate's. There is no
 *    client-scoped SELECT policy on `profiles` for `client_admin`, so
 *    listing (or safely re-checking) another member's row for the same
 *    client requires the service-role client here, with this route
 *    itself performing the authorization check.
 *
 * Additionally: `profiles_client_admin_manage` (migration 013) grants a
 * `client_admin` UPDATE access to same-client profiles, but has no
 * matching `is_ne_admin()` UPDATE policy — an `ne_admin` has no
 * `client_id` of their own (`my_client_id()` is NULL for them), so that
 * policy's `client_id = my_client_id()` never matches for an `ne_admin`
 * acting on someone else's profile. Routing role-change/remove through
 * this server route (service-role client, app-layer authorization)
 * sidesteps that RLS gap uniformly for both roles, and is also the only
 * place that can enforce "a client_admin cannot promote anyone to
 * ne_admin" — the profiles.role CHECK constraint allows 'ne_admin' as a
 * value (unlike `invitations.role`, which structurally excludes it), so
 * without an app-layer check a client_admin could otherwise set a
 * teammate's role straight to 'ne_admin' merely by staying inside their
 * own client_id (the RLS policy's only real constraint).
 */

interface CallerProfile {
  role: string | null;
  client_id: string | null;
}

interface TargetProfile {
  id: string;
  client_id: string | null;
  role: string;
}

const ASSIGNABLE_ROLES = new Set(['client_admin', 'editor', 'ne_admin']);

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

function canManageClient(profile: CallerProfile | null, targetClientId: string | null): boolean {
  if (!profile) return false;
  if (profile.role === 'ne_admin') return true;
  return profile.role === 'client_admin' && !!targetClientId && profile.client_id === targetClientId;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const targetClientId = new URL(req.url).searchParams.get('client_id');
  if (!targetClientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  }
  // Unlike some routes' "silently pin a non-admin caller to their own
  // client_id regardless of what they requested" convention, this checks
  // the *requested* client_id directly (matching src/app/api/keys/route.ts)
  // so a client_admin asking for a different client_id gets an explicit
  // 403 rather than a silently-substituted 200 for their own client.
  if (!canManageClient(profile, targetClientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: members, error } = await admin
    .from('profiles')
    .select('id, full_name, avatar_url, role, client_id, created_at')
    .eq('client_id', targetClientId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (members ?? []) as Record<string, unknown>[];

  const withLastSignIn = await Promise.all(
    rows.map(async (row) => {
      const { data } = await admin.auth.admin.getUserById(row.id as string);
      return { ...row, last_sign_in_at: data?.user?.last_sign_in_at ?? null };
    })
  );

  return NextResponse.json(withLastSignIn);
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id: string = typeof body.id === 'string' ? body.id : '';
  const remove: boolean = body.remove === true;
  const role: string | undefined = typeof body.role === 'string' ? body.role : undefined;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!remove && !role) {
    return NextResponse.json({ error: 'Either role or remove is required' }, { status: 400 });
  }
  if (role && !ASSIGNABLE_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  // A client_admin can manage editor/client_admin teammates for their own
  // client, but can never promote anyone to ne_admin — see the file-level
  // comment: this is the one place that constraint can actually be
  // enforced, since `profiles.role`'s CHECK constraint permits 'ne_admin'
  // as a value.
  if (role === 'ne_admin' && profile?.role !== 'ne_admin') {
    return NextResponse.json({ error: 'Only an ne_admin can grant the ne_admin role' }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from('profiles')
    .select('id, client_id, role')
    .eq('id', id)
    .single();

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (!canManageClient(profile, (target as TargetProfile).client_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const update: Record<string, unknown> = remove ? { client_id: null } : { role };

  const { error } = await admin.from('profiles').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
