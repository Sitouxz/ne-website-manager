import { redirect } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getActiveWorkspace } from '@/lib/workspace';
import { getClientCapabilities } from '@/lib/client-capabilities';
import type { Collection } from '@/lib/supabase/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, clients, activeClient: selectedClient, supabase } = await getActiveWorkspace();
  if (!user) redirect('/login');

  const role       = profile?.role ?? 'editor';
  const clientName = selectedClient?.name ?? 'Website Manager';
  const selectedClientId = selectedClient?.id ?? profile?.client_id ?? null;
  const capabilities = getClientCapabilities(selectedClient);

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
      websiteUrl={selectedClient?.website_url ?? null}
      capabilities={capabilities}
      role={role}
      genericCollections={genericCollections}
    >
      {children}
    </AppShell>
  );
}
