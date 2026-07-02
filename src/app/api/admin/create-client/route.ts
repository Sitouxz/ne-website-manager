import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';

export async function POST(req: Request) {
  // Verify caller is NE admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'ne_admin') {
    return NextResponse.json({ error: 'Forbidden — NE Admin only' }, { status: 403 });
  }

  const body = await req.json();
  const { name, slug, website_url, email, password } = body;

  if (!name || !slug || !email || !password) {
    return NextResponse.json({ error: 'name, slug, email, password required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Create client record
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .insert({ name, slug, website_url: website_url || null })
    .select()
    .single();

  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 });

  // 2. Create auth user
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });

  if (authErr) {
    // Rollback client record
    await admin.from('clients').delete().eq('id', client.id);
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  // 3. Link profile to client with client_admin role
  await admin
    .from('profiles')
    .update({ client_id: client.id, role: 'client_admin' })
    .eq('id', authData.user.id);

  await logActivity(admin, {
    clientId: client.id,
    actorId: user.id,
    action: 'created',
    entityType: 'client',
    entityId: client.id,
    summary: `Created client "${name}"`,
  });

  return NextResponse.json({ success: true, clientId: client.id, userId: authData.user.id });
}
