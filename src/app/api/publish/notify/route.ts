import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyPublish, type PublishEvent } from '@/lib/publish';

/**
 * Server-side entry point for `notifyPublish` (Task 7.1), called by the
 * client-side CMS editors (posts/pages/collection-entries, site globals,
 * navigation) after an explicit publish/save action succeeds.
 *
 * `notifyPublish` itself needs Node's `crypto` module to sign the outbound
 * payload with `client.revalidate_secret`, and that secret must never reach
 * the browser bundle — so it can't be called directly from the 'use client'
 * editor pages. This route is the (thin) server boundary: the browser POSTs
 * `{ clientId, event, entityType, entityId, slug }`, this route validates
 * the caller can act on that client, then does the actual work.
 *
 * Auth mirrors `src/app/api/keys/route.ts`'s `canManage` convention:
 * `ne_admin` (any client) or `client_admin`/`editor` of their own client —
 * i.e. anyone who could have made the save that triggered this call. This
 * is defense-in-depth, not the real boundary (a plain `editor` already
 * can't publish per migration 015's RLS); it just stops a signed-in user
 * from spamming an arbitrary *other* client's revalidate/deploy endpoints
 * by passing a `clientId` that isn't theirs.
 *
 * The actual client-row fetch + `notifyPublish` call happens inside
 * `after()` (see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md)
 * — the response returns immediately once the caller is authorized, so a
 * slow/hanging revalidate or deploy-hook endpoint can only ever extend this
 * request's *background* lifetime (bounded by `notifyPublish`'s own 5s
 * per-delivery timeout), never the time the browser waits for a response.
 * This is the actual "fire-and-forget" boundary; the browser-side callers
 * (see `src/lib/publish-client.ts`) additionally don't await this fetch at
 * all, so both layers agree this must never block a save.
 *
 * Post-Task-7.1 fix: `deploy_hook`/`revalidate_url`/`revalidate_secret` now
 * live on `public.client_publish_config` (migration 018), not `clients` —
 * `clients` has a public-read RLS policy, which used to expose
 * `revalidate_secret` in plaintext to any unauthenticated caller with the
 * anon key. This route now reads `client_publish_config` by `client_id`
 * instead; `notifyPublish`'s own signature is unchanged since it only ever
 * needed a `{ id, revalidate_url?, revalidate_secret?, deploy_hook? }` shape,
 * not literally a `clients` row.
 */

const VALID_EVENTS: PublishEvent[] = ['content.published', 'content.updated', 'content.deleted'];

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
  return profile.client_id === targetClientId;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { user, profile } = await loadCaller(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clientId: string = typeof body.clientId === 'string' ? body.clientId : '';
  const event: PublishEvent = body.event;
  const entityType: string = typeof body.entityType === 'string' ? body.entityType : '';
  const entityId: string = typeof body.entityId === 'string' ? body.entityId : '';
  const slug: string | null = typeof body.slug === 'string' ? body.slug : null;
  const path: string | null = typeof body.path === 'string' ? body.path : null;

  if (!clientId || !entityType || !entityId || !VALID_EVENTS.includes(event)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (!canManage(profile, clientId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Deferred to run after the response is sent — see the file-level comment
  // above. Uses the service-role admin client (not the cookie-scoped one
  // used for the auth check above) both to read `revalidate_secret`
  // reliably regardless of RLS specifics and to write `webhook_deliveries`
  // rows, which have no INSERT policy for regular authenticated sessions
  // (see migration 017_webhooks.sql).
  after(async () => {
    const admin = createAdminClient();
    const { data: config } = await admin
      .from('client_publish_config')
      .select('revalidate_url, revalidate_secret, deploy_hook')
      .eq('client_id', clientId)
      .single();
    if (!config) return;
    await notifyPublish(
      { id: clientId, revalidate_url: config.revalidate_url, revalidate_secret: config.revalidate_secret, deploy_hook: config.deploy_hook },
      { event, entityType, entityId, slug, path },
      admin
    );
  });

  return NextResponse.json({ ok: true });
}
