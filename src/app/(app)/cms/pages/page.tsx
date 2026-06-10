import Topbar from '@/components/Topbar';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { Globe, Lock } from 'lucide-react';
import type { Page, Profile } from '@/lib/supabase/types';

const SELECTED_CLIENT_COOKIE = 'ne_selected_client_id';

function fmtDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function PagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, clients(*)')
    .eq('id', user!.id)
    .single() as { data: Profile | null };

  const isAdmin = profile?.role === 'ne_admin';
  const selectedClientId = isAdmin ? (await cookies()).get(SELECTED_CLIENT_COOKIE)?.value : null;
  const clientId = selectedClientId ?? profile?.client_id;

  let query = supabase
    .from('pages')
    .select('*')
    .order('path', { ascending: true });
  if (clientId) query = query.eq('client_id', clientId);

  const { data = [] } = await query;
  const pages = (data ?? []) as Page[];
  const publicCount = pages.filter((page) => page.status === 'published' && page.visibility === 'public').length;

  return (
    <>
      <Topbar title="Pages" subtitle={`${pages.length} CMS-managed pages`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0 }}>
            These records come directly from Supabase and are exposed through the public pages API when published and public.
          </p>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ne-blue)', background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 99, padding: '6px 12px' }}>
            {publicCount} public
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Page Title</th>
                  <th>URL Path</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {pages.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      No CMS-managed pages found for this site.
                    </td>
                  </tr>
                ) : pages.map((page) => (
                  <tr key={page.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{page.title || '(Untitled)'}</div>
                    </td>
                    <td>
                      <code style={{ fontSize: 12, background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, color: 'var(--fg2)' }}>{page.path}</code>
                    </td>
                    <td><span className={`status-pill ${page.status}`}>{page.status}</span></td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--fg3)' }}>
                        {page.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}
                        {page.visibility}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDate(page.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 20, background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 'var(--r-md)', padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Globe size={18} color="var(--ne-blue)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12.5, color: 'var(--fg2)', margin: 0 }}>
            Page editing controls are hidden until a real page editor is implemented. For now this screen is a truthful inventory of pages currently managed by NE Website Manager.
          </p>
        </div>
      </div>
    </>
  );
}
