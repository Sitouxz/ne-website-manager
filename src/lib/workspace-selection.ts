import type { Client, Profile } from '@/lib/supabase/types';

export function selectActiveClient(
  profile: Profile | null,
  clients: Client[],
  selectedId: string | null | undefined,
) {
  if (profile?.role !== 'ne_admin') return profile?.clients ?? null;
  return clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
}
