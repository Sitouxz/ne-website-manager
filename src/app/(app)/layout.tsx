import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppShell from '@/components/AppShell';
import type { Profile } from '@/lib/supabase/types';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, clients(*)')
    .eq('id', user.id)
    .single() as { data: Profile | null };

  const clientName = profile?.clients?.name ?? 'Website Manager';
  const role       = profile?.role ?? 'editor';

  return (
    <AppShell clientName={clientName} role={role}>
      {children}
    </AppShell>
  );
}
