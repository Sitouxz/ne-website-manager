import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';
import { notifyPublish } from '@/lib/publish';

/**
 * Scheduled-publish cron: flips due `scheduled` posts to `published`.
 *
 * Triggered by Vercel Cron every 5 minutes (see `vercel.json`), which sends
 * `Authorization: Bearer ${CRON_SECRET}`. Requires the `CRON_SECRET`
 * environment variable to be set on the deployment (Vercel dashboard / CLI
 * env vars) — there is no other documentation for this variable in the repo,
 * so note it here for whoever deploys this.
 *
 * Uses the service-role admin client (bypasses RLS) because this operation
 * is intentionally cross-tenant — every client's due posts get published in
 * one pass — and runs with no per-request user session to scope RLS against.
 *
 * Task 7.1: also fires `notifyPublish` (`event: 'content.published'`) per
 * post actually published, in addition to the `activity_log` entry. Client
 * rows are batch-fetched once (by distinct `client_id`) rather than per
 * post, since this admin client already bypasses RLS and a scheduled batch
 * can publish several posts for the same client in one run.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  // An unset/empty CRON_SECRET must never act as a wildcard match — require
  // a non-empty secret configured server-side AND an exact header match.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Single bulk conditional UPDATE ... RETURNING, rather than SELECT-then-
  // loop-update: avoids a race where a row's scheduled_at passes between a
  // separate SELECT and UPDATE, and avoids N+1 round trips. published_at
  // reuses `now` — the same timestamp used to select the due rows — so every
  // post published in this run gets one consistent timestamp instead of a
  // slightly-later per-row `new Date()`. scheduled_at is cleared to null now
  // that it's fulfilled, so a published row never carries a stale scheduled
  // time (the same bug class Task 3.3 fixed for published_at handling).
  const { data: publishedRows, error } = await supabase
    .from('posts')
    .update({ status: 'published', published_at: now, scheduled_at: null })
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (publishedRows ?? []) as Array<Record<string, unknown>>;

  // Batch-fetch the distinct clients touched by this run once, rather than
  // once per row — small win, avoids N+1 when a run publishes several posts
  // for the same client.
  const clientIds = Array.from(new Set(rows.map((row) => row.client_id as string)));
  const clientsById = new Map<string, Record<string, unknown>>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await supabase
      .from('clients')
      .select('id, revalidate_url, revalidate_secret, deploy_hook')
      .in('id', clientIds);
    for (const c of (clientRows ?? []) as Array<Record<string, unknown>>) {
      clientsById.set(c.id as string, c);
    }
  }

  // Activity logging + webhook notification per row don't need to be
  // transactional with the publish itself — both `logActivity` and
  // `notifyPublish` never throw, so a logging/delivery failure can't undo
  // or block the (already-committed) publish.
  for (const row of rows) {
    await logActivity(supabase, {
      clientId: row.client_id as string,
      actorId: null,
      action: 'published',
      entityType: 'post',
      entityId: row.id as string,
      summary: `Published "${row.title as string}" (scheduled)`,
    });

    const client = clientsById.get(row.client_id as string);
    if (client) {
      await notifyPublish(
        { id: client.id as string, revalidate_url: client.revalidate_url as string | null, revalidate_secret: client.revalidate_secret as string | null, deploy_hook: client.deploy_hook as string | null },
        { event: 'content.published', entityType: 'post', entityId: row.id as string, slug: row.slug as string | undefined },
        supabase
      );
    }
  }

  return NextResponse.json({ published: rows.length, ids: rows.map((r) => r.id) });
}
