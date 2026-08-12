import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';
import { DEFAULT_CLIENT_CAPABILITIES } from '@/lib/client-capabilities';
import { DEFAULT_TEMPLATE_SLUG, getTemplate } from '@/lib/templates/catalog';
import { applyTemplate, describeApplied } from '@/lib/templates/apply';

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
  const { name, slug, website_url, email, password, template: templateSlug } = body;

  if (!name || !slug || !email || !password) {
    return NextResponse.json({ error: 'name, slug, email, password required' }, { status: 400 });
  }

  // An unknown template slug is rejected rather than silently falling back to
  // blank: the caller asked for a specific starting shape, and quietly giving
  // them an empty CMS is the kind of "success" that gets discovered a week
  // later. Omitting `template` entirely is fine and means blank.
  const template = templateSlug ? getTemplate(templateSlug) : getTemplate(DEFAULT_TEMPLATE_SLUG);
  if (!template) {
    return NextResponse.json({ error: `Unknown template "${templateSlug}"` }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Create client record
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .insert({
      name,
      slug,
      website_url: website_url || null,
      // Capability overrides are part of the template, applied at creation so
      // the client's very first sidebar already matches the site they have.
      ...(template.capabilities
        ? { capabilities: { ...DEFAULT_CLIENT_CAPABILITIES, ...template.capabilities } }
        : {}),
    })
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

  // 4. Apply the template. Deliberately after the client and login exist and
  //    never rolled back — see `applyTemplate`'s header for why a partial
  //    template beats deleting a working client.
  const applied = await applyTemplate(admin, client.id, template);

  await logActivity(admin, {
    clientId: client.id,
    actorId: user.id,
    action: 'created',
    entityType: 'client',
    entityId: client.id,
    summary: template.collections.length > 0 || template.navigation?.length
      ? `Created client "${name}" from the ${template.name} template with ${describeApplied(applied)}`
      : `Created client "${name}"`,
  });

  return NextResponse.json({
    success: true,
    clientId: client.id,
    userId: authData.user.id,
    template: template.slug,
    applied,
  });
}
