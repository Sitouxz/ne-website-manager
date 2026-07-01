'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, MoreHorizontal, Edit, Trash2, Loader2 } from 'lucide-react';
import { useAllCollections } from '@/lib/collections/useCollection';
import { createClient } from '@/lib/supabase/client';
import { getIcon } from '@/lib/collections/icons';

export default function CollectionsPage() {
  const { collections, loading, refetch } = useAllCollections();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Delete this collection? All of its records will be deleted too. This cannot be undone.')) return;
    setDeleting(id);
    const supabase = createClient();
    await supabase.from('collections').delete().eq('id', id);
    setDeleting(null);
    setOpenMenu(null);
    refetch();
  }

  return (
    <>
      <Topbar title="Collections" subtitle="Content types available in this CMS" />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0, maxWidth: 520 }}>
            Collections define the content types this client can manage. Built-in collections (Blog Posts, Pages, Properties) ship with the CMS — create a custom collection for anything unique to this client.
          </p>
          <Link href="/cms/collections/new" className="btn-ne">
            <Plus size={15} /> New Collection
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Collection</th>
                  <th>Slug</th>
                  <th>Fields</th>
                  <th>Type</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                      </div>
                    </td>
                  </tr>
                ) : collections.map((collection) => {
                  const Icon = getIcon(collection.icon);
                  return (
                    <tr key={collection.id} style={{ position: 'relative' }}>
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon size={15} color="var(--ne-blue)" />
                          {collection.is_system ? (
                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{collection.name}</span>
                          ) : (
                            <Link href={`/cms/collections/${collection.id}`} style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)', textDecoration: 'none' }}>
                              {collection.name}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td><code style={{ fontSize: 12, background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, color: 'var(--fg2)' }}>{collection.slug}</code></td>
                      <td style={{ color: 'var(--fg2)', fontSize: 13 }}>{collection.fields.length}</td>
                      <td>
                        <span style={{ fontSize: 12, background: collection.is_system ? 'var(--ne-blue-bg)' : 'var(--surface-3)', color: collection.is_system ? 'var(--ne-blue)' : 'var(--fg2)', padding: '3px 8px', borderRadius: 99, fontWeight: 600 }}>
                          {collection.is_system ? 'System' : 'Custom'}
                        </span>
                      </td>
                      <td style={{ position: 'relative' }}>
                        {!collection.is_system && (
                          <>
                            <button
                              onClick={() => setOpenMenu(openMenu === collection.id ? null : collection.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenu === collection.id && (
                              <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                                <Link href={`/cms/collections/${collection.id}`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                                  onClick={() => setOpenMenu(null)}>
                                  <Edit size={14} /> Edit
                                </Link>
                                <button
                                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                                  onClick={() => handleDelete(collection.id)}
                                  disabled={deleting === collection.id}
                                >
                                  {deleting === collection.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                                  Delete
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
