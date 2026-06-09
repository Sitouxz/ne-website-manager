import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/Sidebar';
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
    <div style={{ display: 'flex' }}>
      <Sidebar clientName={clientName} role={role} />
      <div className="app-layout">{children}</div>
    </div>
  );
}
