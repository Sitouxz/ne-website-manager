import { createClient } from '@/lib/supabase/client';

/**
 * Shared load/save helpers for `site_globals` rows, used by both
 * `src/app/(app)/settings/globals/page.tsx` (footer/theme/social/contact)
 * and `src/app/(app)/announcements/page.tsx` (announcement) so the two
 * pages don't each reimplement the same "read one row by (client_id, key),
 * upsert one row by (client_id, key)" boilerplate.
 */

export async function loadGlobal<T>(clientId: string, key: string, fallback: T): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase
    .from('site_globals')
    .select('value')
    .eq('client_id', clientId)
    .eq('key', key)
    .maybeSingle();
  return (data?.value as T | undefined) ?? fallback;
}

export async function saveGlobal(clientId: string, key: string, value: unknown): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase
    .from('site_globals')
    .upsert({ client_id: clientId, key, value }, { onConflict: 'client_id,key' });
  return error?.message ?? null;
}
