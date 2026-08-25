import type { SupabaseClient } from '@supabase/supabase-js';
import { logActivity } from '@/lib/activity';
import { notifyPublish } from '@/lib/publish';
import { canPublish, groupMembers, type Release, type ReleaseMember } from './releases';

/**
 * Publishing a release: every member goes live in one pass, and the website
 * is told once.
 *
 * Called by `/api/cron/publish-scheduled` for due releases and by the
 * publish route for "publish now". Both use the service-role client, for the
 * same reason scheduled publishing already does — the cron has no user
 * session to scope RLS against, and elevating content status is a decision
 * `015`/`016` place on the server side rather than in a client-side write.
 *
 * ## One update per table, one notification per release
 *
 * The per-entity path costs a webhook delivery and a rebuild trigger per
 * row. A ten-item campaign therefore costs ten of each, and every one of
 * them is a moment where the site is partially updated. A release issues
 * three bulk updates at most and exactly one `notifyPublish`.
 *
 * ## Not transactional, ordered to fail safe
 *
 * Supabase gives no cross-statement transaction here, so the order is:
 * flip the members, then mark the release published, then notify. An
 * interruption before the release row is marked leaves members live and the
 * release still `scheduled` — the next cron pass re-runs it, the member
 * updates are idempotent (already-published rows are set to published
 * again), and the notification fires then. The alternative order could mark
 * a release done whose content never went live, which is the failure nobody
 * would notice.
 */

export interface ReleasePublishResult {
  ok: boolean;
  published: number;
  reason?: string;
}

const TABLE_BY_TYPE = {
  post: 'posts',
  page: 'pages',
  collection_entry: 'collection_items',
} as const;

export async function loadReleaseMembers(
  supabase: SupabaseClient,
  releaseId: string,
): Promise<ReleaseMember[]> {
  const [posts, pages, entries] = await Promise.all([
    supabase.from('posts').select('id, title, status').eq('release_id', releaseId),
    supabase.from('pages').select('id, title, status').eq('release_id', releaseId),
    supabase.from('collection_items').select('id, slug, status').eq('release_id', releaseId),
  ]);

  return [
    ...(posts.data ?? []).map((r) => ({
      id: r.id as string,
      entityType: 'post' as const,
      title: (r.title as string) || '(untitled post)',
      status: r.status as string,
    })),
    ...(pages.data ?? []).map((r) => ({
      id: r.id as string,
      entityType: 'page' as const,
      title: (r.title as string) || '(untitled page)',
      status: r.status as string,
    })),
    ...(entries.data ?? []).map((r) => ({
      id: r.id as string,
      entityType: 'collection_entry' as const,
      title: (r.slug as string) || '(untitled entry)',
      status: r.status as string,
    })),
  ];
}

export async function publishRelease(
  supabase: SupabaseClient,
  release: Release,
  now: string = new Date().toISOString(),
): Promise<ReleasePublishResult> {
  const members = await loadReleaseMembers(supabase, release.id);

  const check = canPublish(release, members);
  if (!check.ok) return { ok: false, published: 0, reason: check.reason };

  const grouped = groupMembers(members);

  // Step 1 — flip every member. Idempotent, so a re-run after an
  // interruption is harmless.
  for (const [type, ids] of Object.entries(grouped) as [keyof typeof TABLE_BY_TYPE, string[]][]) {
    if (ids.length === 0) continue;
    const { error } = await supabase
      .from(TABLE_BY_TYPE[type])
      .update({ status: 'published', published_at: now, scheduled_at: null })
      .in('id', ids);
    if (error) {
      return { ok: false, published: 0, reason: `Could not publish the ${type} items: ${error.message}` };
    }
  }

  // Step 2 — mark the release done. Only after its content is actually live.
  const { error: releaseError } = await supabase
    .from('releases')
    .update({ status: 'published', published_at: now })
    .eq('id', release.id);

  if (releaseError) {
    // Members are live; the release will be retried and the notification
    // sent then. Reported rather than swallowed so the run's output shows it.
    return { ok: false, published: members.length, reason: releaseError.message };
  }

  await logActivity(supabase, {
    clientId: release.client_id,
    actorId: null,
    action: 'published',
    entityType: 'release',
    entityId: release.id,
    summary: `Published the "${release.name}" release — ${members.length} ${members.length === 1 ? 'item' : 'items'} went live together`,
    meta: { member_count: members.length, members: members.map((m) => ({ type: m.entityType, id: m.id })) },
  });

  // Step 3 — tell the website. Once.
  const { data: config } = await supabase
    .from('client_publish_config')
    .select('revalidate_url, revalidate_secret, deploy_hook')
    .eq('client_id', release.client_id)
    .single();

  if (config) {
    await notifyPublish(
      {
        id: release.client_id,
        revalidate_url: (config.revalidate_url as string | null) ?? null,
        revalidate_secret: (config.revalidate_secret as string | null) ?? null,
        deploy_hook: (config.deploy_hook as string | null) ?? null,
      },
      {
        event: 'content.published',
        entityType: 'release',
        entityId: release.id,
      },
      // The same client the flip used, so the delivery row lands under the
      // right tenant and the dashboard's failed-delivery alert can see it.
      supabase,
    );
  }

  return { ok: true, published: members.length };
}
