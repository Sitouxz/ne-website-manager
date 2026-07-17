import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell';
import type { Client, Collection, Profile } from '@/lib/supabase/types';

const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, clients(*)')
    .eq('id', user.id)
    .single() as { data: Profile | null };

  const role       = profile?.role ?? 'editor';
  const isAdmin    = role === 'ne_admin';
  let clients: Client[] = [];
  let selectedClient = profile?.clients ?? null;

  if (isAdmin) {
    const { data: rows } = await supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true });
    clients = (rows ?? []) as Client[];

    const selectedId = (await cookies()).get(SELECTED_CLIENT_COOKIE)?.value;
    selectedClient = clients.find((client) => client.id === selectedId) ?? clients[0] ?? null;
  }

  const clientName = selectedClient?.name ?? 'Website Manager';
  const selectedClientId = selectedClient?.id ?? profile?.client_id ?? null;
  const clientSlug = selectedClient?.slug ?? null;

  // Sidebar's dynamic "Collections" nav (Task 4.3) — only `storage='generic'`
  // collections get an entries list/editor at all (native/global collections
  // are out of scope, same as the collections list page's own scoping), so
  // only those are worth surfacing here. Scoped to the resolved client the
  // same way every other per-client sidebar/AppShell fetch is (`selectedClientId`
  // tracks the cookie-selected client for `ne_admin`, or the user's own
  // `client_id` otherwise) — skipped entirely when there's no client to
  // scope to yet (e.g. an admin who hasn't picked one).
  let genericCollections: Pick<Collection, 'id' | 'name'>[] = [];
  if (selectedClientId) {
    const { data: collectionRows } = await supabase
      .from('collections')
      .select('id, name')
      .eq('storage', 'generic')
      .eq('client_id', selectedClientId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    genericCollections = (collectionRows ?? []) as Pick<Collection, 'id' | 'name'>[];
  }

  return (
    <AppShell
      clientName={clientName}
      clients={clients}
      selectedClientId={selectedClientId}
      clientSlug={clientSlug}
      role={role}
      genericCollections={genericCollections}
    >
      {children}
    </AppShell>
  );
}
