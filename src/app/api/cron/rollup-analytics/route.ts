import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const DAY_MS = 86_400_000;

/**
 * Analytics-rollup cron: aggregates raw `page_view` rows from
 * `analytics_events` into the pre-computed `analytics_daily` table (one row
 * per `client_id`/`day`/`path`, see migration 020) so the dashboard's
 * 30/90-day views never have to scan raw events directly.
 *
 * Same `Authorization: Bearer ${CRON_SECRET}` bearer-auth pattern as
 * `publish-scheduled` (see that route for the full rationale) — an
 * unset/empty `CRON_SECRET` must never act as a wildcard match, so this
 * requires a non-empty secret configured server-side AND an exact header
 * match.
 *
 * Window: re-aggregates the last 2 UTC calendar days (yesterday + today) on
 * every run, not just "the day that just ended". Two reasons:
 *   1. Vercel Cron triggers this once a day (see `vercel.json`) at a fixed
 *      time, so "today" is always partial at run time — re-aggregating it
 *      on tomorrow's run brings it up to date rather than leaving a
 *      permanently-stale partial-day row.
 *   2. Re-including yesterday guards against a single missed/failed run
 *      (Vercel Cron has no built-in retry): if one run fails outright,
 *      the next run still backfills the day it missed.
 * Anything older than 2 days is assumed already finalized by an earlier
 * run and is left untouched — this keeps each run's read cheap (a couple of
 * days of events, not the whole table) rather than reprocessing history.
 *
 * Aggregation happens here in JS (fetch raw events for the window, group by
 * client_id/day/path, then upsert) rather than via a SQL `GROUP BY` RPC:
 * this route only has the generic `@supabase/supabase-js` client available
 * (no raw-SQL execution helper), and grouping in JS keeps this route
 * testable against the same in-memory `mockSupabase` helper the rest of the
 * cron suite uses.
 *
 * Uses the service-role admin client (bypasses RLS) because this is a
 * scheduled, cross-tenant job — every client's page views get re-aggregated
 * in one pass — with no per-request user session to scope RLS against
 * (same rationale as `publish-scheduled`).
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

  // Start of "yesterday" (UTC) through now — a 2-UTC-calendar-day window.
  const now = new Date();
  const todayStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(todayStartUtc.getTime() - DAY_MS);

  const { data: eventsData, error } = await supabase
    .from('analytics_events')
    .select('client_id, path, visitor_id, created_at')
    .eq('event_name', 'page_view')
    .gte('created_at', windowStart.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type EventRow = { client_id: string; path: string; visitor_id: string | null; created_at: string };
  const events = (eventsData ?? []) as EventRow[];

  // Group by (client_id, day, path). `views` is the raw event count for the
  // grouping; `visitors` is the size of the distinct-visitor_id set — a
  // visitor who views the same path twice in a day counts once toward
  // `visitors` but twice toward `views`.
  type Group = { client_id: string; day: string; path: string; views: number; visitorIds: Set<string> };
  const groups = new Map<string, Group>();

  for (const event of events) {
    const day = new Date(event.created_at).toISOString().slice(0, 10);
    const key = `${event.client_id}|${day}|${event.path}`;
    let group = groups.get(key);
    if (!group) {
      group = { client_id: event.client_id, day, path: event.path, views: 0, visitorIds: new Set() };
      groups.set(key, group);
    }
    group.views += 1;
    if (event.visitor_id) group.visitorIds.add(event.visitor_id);
  }

  const rows = [...groups.values()].map((group) => ({
    client_id: group.client_id,
    day: group.day,
    path: group.path,
    views: group.views,
    visitors: group.visitorIds.size,
  }));

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('analytics_daily')
      .upsert(rows, { onConflict: 'client_id,day,path' });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ aggregated: rows.length });
}
