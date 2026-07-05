import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

/**
 * Creates a team invitation for a client and emails it via Supabase Auth's
 * admin invite API, backed by `public.invitations` (migration 013_team.sql).
 *
 * Auth: caller must be a signed-in `client_admin` (their own client) or
 * `ne_admin` (any client, via `client_id` in the body) — matches the
 * `client_admin`-or-`ne_admin` shape used by `src/app/api/keys/route.ts`.
 * A plain `editor` gets 403.
 *
 * The `invitations` row is written through the user-scoped client
 * (`createClient()`), not the service-role client: `invitations_manage`
 * RLS (migration 013) already permits exactly this caller (ne_admin, or
 * client_admin scoped to their own client) to INSERT, so there's no need
 * to bypass RLS here. The service-role client (`createAdminClient()`) is
 * used only for the one operation that genuinely requires it —
 * `auth.admin.inviteUserByEmail`, an admin-only Supabase Auth API with no
 * RLS-scoped equivalent.
 */

interface CallerProfile {
  role: string | null;
  client_id: string | null;
}

const INVITE_EXPIRY_DAYS = 7;
const ALLOWED_ROLES = new Set(['client_admin', 'editor']);

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

/** Matches `generateApiKey`'s high-entropy pattern (src/lib/api/auth.ts) — a 32-byte random hex string. */
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email: string = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role: string = typeof body.role === 'string' ? body.role : '';

  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  // The `invitations.role` CHECK constraint (migration 013) already only
  // allows 'client_admin'|'editor' — there is no 'ne_admin' value in the
  // schema at all, so this can never succeed at the DB level either way.
  // Validated here too so a client_admin attempting to invite an
  // 'ne_admin' gets a clean 400 with a clear message instead of a raw
  // Postgres constraint-violation error.
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "role must be 'client_admin' or 'editor'" }, { status: 400 });
  }

  // An ne_admin has no client of their own and must specify one; a
  // client_admin is always pinned to their own client_id regardless of
  // anything the request body claims, so a client_admin can't spoof a
  // client_id param to invite into a client they don't belong to.
  const targetClientId = profile?.role === 'ne_admin'
    ? (typeof body.client_id === 'string' ? body.client_id : undefined)
    : profile?.client_id ?? undefined;

  if (!targetClientId) {
    return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  }
  if (!canManage(profile, targetClientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error } = await supabase
    .from('invitations')
    .insert({
      client_id: targetClientId,
      email,
      role,
      invited_by: user.id,
      token,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = new URL(req.url).origin;
  const redirectTo = `${origin}/accept-invite?token=${token}`;

  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError) {
    // Don't leave an orphaned invitation row that can never be redeemed
    // (no email was actually sent) — roll it back on the user-scoped
    // client, same one that created it.
    await supabase.from('invitations').delete().eq('id', (invitation as { id: string }).id);
    // Don't return inviteError.message to the caller: Supabase Auth's
    // invite API returns a distinguishable error when the target email
    // already has a registered account, and a client_admin can invite
    // ANY email address — so echoing the real message back would let a
    // lower-privileged caller probe whether an arbitrary email is
    // registered anywhere in the whole system (cross-tenant account
    // enumeration). Log the real error server-side only.
    console.error('inviteUserByEmail failed:', inviteError.message);
    return NextResponse.json(
      { error: 'Failed to send invitation. Please try again or contact support.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, id: (invitation as { id: string }).id, expires_at: expiresAt });
}
