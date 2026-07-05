import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/**
 * Consumes a team invitation token, applying its `client_id`/`role` to the
 * calling (already-authenticated) user's own `profiles` row.
 *
 * This route deliberately exists outside the `invitations_manage` RLS
 * policy's reach: a freshly-invited user has no elevated role yet
 * (`handle_new_user`, migration 001, gives every new `auth.users` row a
 * default `profiles` row with role='editor', client_id=NULL) so they
 * cannot read their own invitation row through the client_admin/ne_admin-
 * scoped RLS on `invitations` (migration 013_team.sql). Token lookup and
 * the profile/invitation writes below therefore go through the
 * service-role client (`createAdminClient()`) — this route itself is the
 * privileged boundary, which is why it independently verifies the
 * invitation's `email` matches the authenticated caller's email before
 * doing anything: accepting someone else's invitation token while signed
 * in as a different user would otherwise let any authenticated user hand
 * themselves an arbitrary client_id/role by knowing (or guessing) another
 * person's invite token.
 *
 * The caller's identity is still established via the normal user-scoped
 * client (`createClient()`) — `auth.getUser()` reads the request's own
 * session cookies, so this route only ever acts on the signed-in caller's
 * own profile, never an arbitrary `profiles.id` supplied by the client.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token: string = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single();

  if (!invitation) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'This invitation has already been accepted' }, { status: 400 });
  }
  if (new Date(invitation.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
  }

  // The load-bearing check: reject unless the invitation was actually
  // issued to the email address the caller is signed in as.
  const callerEmail = user.email?.toLowerCase();
  const invitedEmail = typeof invitation.email === 'string' ? invitation.email.toLowerCase() : null;
  if (!callerEmail || !invitedEmail || callerEmail !== invitedEmail) {
    return NextResponse.json(
      { error: 'This invitation was issued to a different email address' },
      { status: 403 }
    );
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ client_id: invitation.client_id, role: invitation.role })
    .eq('id', user.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id);

  return NextResponse.json({ success: true });
}
