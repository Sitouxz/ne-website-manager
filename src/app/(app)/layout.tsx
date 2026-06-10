import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell';
import type { Client, Profile } from '@/lib/supabase/types';

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

  return (
    <AppShell clientName={clientName} clients={clients} selectedClientId={selectedClientId} role={role}>
      {children}
    </AppShell>
  );
}
