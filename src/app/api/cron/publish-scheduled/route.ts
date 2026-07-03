import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';

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
 * Fires publish webhooks in Phase 7 (not built yet); for now this only logs
 * one `activity_log` entry per post actually published.
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

  // Activity logging per row doesn't need to be transactional with the
  // publish itself — logActivity never throws, so a logging failure can't
  // undo or block the (already-committed) publish.
  for (const row of rows) {
    await logActivity(supabase, {
      clientId: row.client_id as string,
      actorId: null,
      action: 'published',
      entityType: 'post',
      entityId: row.id as string,
      summary: `Published "${row.title as string}" (scheduled)`,
    });
  }

  return NextResponse.json({ published: rows.length, ids: rows.map((r) => r.id) });
}
