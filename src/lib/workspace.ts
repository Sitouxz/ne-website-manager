import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import type { Client, Profile } from '@/lib/supabase/types';
import { selectActiveClient } from '@/lib/workspace-selection';

export const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';

/**
 * The single request-scoped source of truth for the authenticated workspace.
 * React.cache deduplicates calls made by the app layout and page during the
 * same server render, so every surface receives the exact same client.
 */
export const getActiveWorkspace = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null, clients: [] as Client[], activeClient: null, supabase };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, clients(*)')
    .eq('id', user.id)
    .single() as { data: Profile | null };

  let clients: Client[] = [];
  let selectedId: string | null = null;

  if (profile?.role === 'ne_admin') {
    const [{ data: rows }, cookieStore] = await Promise.all([
      supabase.from('clients').select('*').order('name', { ascending: true }),
      cookies(),
    ]);
    clients = (rows ?? []) as Client[];
    selectedId = cookieStore.get(SELECTED_CLIENT_COOKIE)?.value ?? null;
  }

  const activeClient = selectActiveClient(profile, clients, selectedId);
  return { user, profile, clients, activeClient, supabase };
});
