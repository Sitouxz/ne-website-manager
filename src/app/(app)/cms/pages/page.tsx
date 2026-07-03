'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Globe, Lock, MoreHorizontal, Edit, Trash2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Page } from '@/lib/supabase/types';

function fmtDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PagesPage() {
  const [pages,    setPages]    = useState<Page[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { selectedClientId } = useSelectedClient();

  const fetchPages = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('pages')
      .select('*')
      .order('path', { ascending: true });
    if (selectedClientId) query = query.eq('client_id', selectedClientId);
    const { data } = await query;
    setPages((data ?? []) as Page[]);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchPages();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPages]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this page? This cannot be undone.')) return;
    setDeleting(id);
    const supabase = createClient();
    await supabase.from('pages').delete().eq('id', id);
    setPages((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
    setOpenMenu(null);
  }

  const publicCount = pages.filter((page) => page.status === 'published' && page.visibility === 'public').length;

  return (
    <>
      <Topbar title="Pages" subtitle={`${pages.length} CMS-managed pages`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0 }}>
              These records are exposed through the public pages API when published and public.
            </p>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ne-blue)', background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 99, padding: '6px 12px' }}>
              {publicCount} public
            </div>
          </div>
          <Link href="/cms/pages/new" className="btn-ne">
            <Plus size={15} /> New Page
          </Link>
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
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading pages...
                      </div>
                    </td>
                  </tr>
                ) : pages.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      No CMS-managed pages found for this site. Create your first page!
                    </td>
                  </tr>
                ) : pages.map((page) => (
                  <tr key={page.id} style={{ position: 'relative' }}>
                    <td style={{ paddingLeft: 20 }}>
                      <Link href={`/cms/pages/${page.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                        {page.title || '(Untitled)'}
                      </Link>
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
                    <td style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenMenu(openMenu === page.id ? null : page.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === page.id && (
                        <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                          <Link href={`/cms/pages/${page.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                            onClick={() => setOpenMenu(null)}>
                            <Edit size={14} /> Edit
                          </Link>
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                            onClick={() => handleDelete(page.id)}
                            disabled={deleting === page.id}
                          >
                            {deleting === page.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {pages.length} pages</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
