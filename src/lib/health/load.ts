import type { SupabaseClient } from '@supabase/supabase-js';
import { daysAgoIso } from '@/lib/dates';
import { sweep, type HealthReport } from './sweep';

/**
 * Fetches everything `sweep` needs for one client and runs it.
 *
 * Split from `sweep.ts` so the checks stay pure and testable without a
 * database, and shared between the two callers that must never disagree:
 * the dashboard (which shows one client on demand) and the weekly cron
 * (which walks every client). A second implementation of "what does the
 * sweep read" is how the dashboard and the digest end up reporting
 * different numbers for the same website.
 *
 * The caller supplies the Supabase client, which decides the security model:
 * the dashboard passes a user-scoped client so RLS confines the query to the
 * caller's own tenant, and the cron passes the admin client because it is
 * deliberately cross-tenant and has no user session to scope against. This
 * module never chooses for them.
 */

/** How far back a failed delivery still counts as "the site may be stale". */
const DELIVERY_WINDOW_DAYS = 7;

/**
 * Content is capped per table. A sweep is a weekly overview, not an
 * exhaustive audit, and an unbounded scan of a large client's media library
 * would turn a dashboard card into a timeout. The cap is generous enough
 * that no current client comes close.
 */
const SCAN_LIMIT = 1000;

export async function loadHealthReport(
  supabase: SupabaseClient,
  client: { id: string; name: string },
  now: Date = new Date(),
): Promise<HealthReport> {
  const since = daysAgoIso(DELIVERY_WINDOW_DAYS);

  const [posts, pages, entries, collections, media, deliveries] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, slug, status, updated_at, cover_url, cover_alt, content, seo_title, seo_description')
      .eq('client_id', client.id)
      .limit(SCAN_LIMIT),
    supabase
      .from('pages')
      .select('id, title, path, status, updated_at, content, seo_title, seo_description')
      .eq('client_id', client.id)
      .limit(SCAN_LIMIT),
    supabase
      .from('collection_items')
      .select('id, collection_id, slug, status, updated_at, data')
      .eq('client_id', client.id)
      .limit(SCAN_LIMIT),
    supabase.from('collections').select('id, name, fields').eq('client_id', client.id),
    supabase.from('media').select('id, url, filename, created_at').eq('client_id', client.id).limit(SCAN_LIMIT),
    supabase
      .from('webhook_deliveries')
      .select('ok, url, created_at')
      .eq('client_id', client.id)
      .eq('ok', false)
      .gte('created_at', since),
  ]);

  return sweep({
    clientId: client.id,
    clientName: client.name,
    posts: posts.data ?? [],
    pages: pages.data ?? [],
    entries: entries.data ?? [],
    collections: collections.data ?? [],
    media: media.data ?? [],
    deliveries: deliveries.data ?? [],
    now,
  });
}
