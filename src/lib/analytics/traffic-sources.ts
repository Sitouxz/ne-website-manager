import type { SupabaseClient } from '@supabase/supabase-js';
import { hostOf, type ExtraHost, type SourceCategory } from '@/lib/analytics/channels';

/**
 * Extra referrer hosts from `analytics_traffic_sources` (migration 028), so
 * the source lists in `channels.ts` can be extended without a deploy. Read
 * with the service-role client by the beacon routes and cached per instance
 * for 10 minutes; any error (e.g. table missing) falls back to no extras —
 * channel derivation must never break ingestion.
 */
const TTL_MS = 10 * 60_000;
let cache: { at: number; hosts: ExtraHost[] } | null = null;

const CATEGORIES: SourceCategory[] = ['search', 'social', 'ai', 'email'];

export async function loadExtraHosts(admin: SupabaseClient, nowMs = Date.now()): Promise<ExtraHost[]> {
  if (cache && nowMs - cache.at < TTL_MS) return cache.hosts;
  try {
    const { data, error } = await admin.from('analytics_traffic_sources').select('host, name, category');
    const hosts = error
      ? []
      : ((data ?? []) as ExtraHost[]).filter((h) => h.host && h.name && CATEGORIES.includes(h.category));
    cache = { at: nowMs, hosts };
    return hosts;
  } catch {
    return [];
  }
}

/** Test hook. */
export function resetTrafficSourceCache() {
  cache = null;
}

/** `clients.website_url` → bare host used to recognise self-referrals. */
export function siteHostOf(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  return hostOf(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`);
}
