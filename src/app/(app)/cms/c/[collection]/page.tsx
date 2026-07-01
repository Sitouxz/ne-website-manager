'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { createElement, use, useState } from 'react';
import { Plus, Search, MoreHorizontal, Edit, Trash2, Loader2 } from 'lucide-react';
import { useCollection, useCollectionItems } from '@/lib/collections/useCollection';
import { getIcon } from '@/lib/collections/icons';
import type { FieldDef } from '@/lib/supabase/types';

function formatValue(field: FieldDef | undefined, value: unknown): string {
  if (value == null || value === '') return '—';
  if (field?.type === 'select' && field.options?.choices) {
    return field.options.choices.find((c) => c.value === value)?.label ?? String(value);
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
}

export default function CollectionListPage({ params }: { params: Promise<{ collection: string }> }) {
  const { collection: slug } = use(params);
  const { def, clientId, loading: defLoading } = useCollection(slug);
  const { items, loading: itemsLoading, remove } = useCollectionItems(def, clientId);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loading = defLoading || itemsLoading;

  if (defLoading) {
    return (
      <>
        <Topbar title="Loading..." />
        <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  if (!def) {
    return (
      <>
        <Topbar title="Not found" />
        <div className="page-body">
          <p style={{ color: 'var(--fg3)', fontSize: 13.5 }}>No collection named &ldquo;{slug}&rdquo; exists for this client.</p>
        </div>
      </>
    );
  }

  const Icon = getIcon(def.icon);
  const statuses = ['All', ...def.options.statusValues];
  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]));

  async function handleDelete(id: string) {
    if (!confirm(`Delete this ${def!.name_singular.toLowerCase()}? This cannot be undone.`)) return;
    setDeleting(id);
    await remove(id);
    setDeleting(null);
    setOpenMenu(null);
  }

  const filtered = items.filter((item) => {
    const matchesStatus = status === 'All' || item.status === status;
    const title = String(item[def.options.titleField] ?? '').toLowerCase();
    const slugValue = String(item.slug ?? '').toLowerCase();
    const matchesSearch = !search || title.includes(search.toLowerCase()) || slugValue.includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <>
      <Topbar title={def.name} subtitle={`${items.length} ${items.length === 1 ? def.name_singular.toLowerCase() : def.name.toLowerCase()} total`} />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {statuses.map((s) => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: status === s ? 'var(--ne-blue)' : 'var(--surface)',
                color:      status === s ? '#fff'          : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {s === 'All' ? `All ${def.name}` : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <Link href={`/cms/c/${slug}/new`} className="btn-ne">
            <Plus size={15} /> New {def.name_singular}
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px' }}>
              <Search size={14} color="var(--fg3)" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${def.name.toLowerCase()}...`}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
              />
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg3)' }}>
              {createElement(Icon, { size: 14 })} {def.is_system ? 'System collection' : 'Custom collection'}
            </span>
          </div>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  {def.options.listColumns.map((col, i) => (
                    <th key={col} style={i === 0 ? { paddingLeft: 20 } : undefined}>
                      {col === 'status' ? 'Status' : fieldByKey.get(col)?.label ?? col}
                    </th>
                  ))}
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={def.options.listColumns.length + 1} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={def.options.listColumns.length + 1} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      {items.length === 0 ? `No ${def.name.toLowerCase()} yet. Add the first one!` : 'No records match your filters.'}
                    </td>
                  </tr>
                ) : filtered.map((item) => (
                  <tr key={item.id} style={{ position: 'relative' }}>
                    {def.options.listColumns.map((col, i) => {
                      if (col === 'status') {
                        return <td key={col}><span className={`status-pill ${item.status}`}>{item.status}</span></td>;
                      }
                      if (i === 0) {
                        return (
                          <td key={col} style={{ paddingLeft: 20, maxWidth: 320 }}>
                            <Link href={`/cms/c/${slug}/${item.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                              {String(item[col] ?? '') || '(Untitled)'}
                            </Link>
                            {item.slug ? <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 1 }}>/{String(item.slug)}</div> : null}
                          </td>
                        );
                      }
                      return <td key={col} style={{ color: 'var(--fg2)', fontSize: 13 }}>{formatValue(fieldByKey.get(col), item[col])}</td>;
                    })}
                    <td style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenMenu(openMenu === item.id ? null : item.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === item.id && (
                        <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                          <Link href={`/cms/c/${slug}/${item.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                            onClick={() => setOpenMenu(null)}>
                            <Edit size={14} /> Edit
                          </Link>
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                            onClick={() => handleDelete(item.id)}
                            disabled={deleting === item.id}
                          >
                            {deleting === item.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
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
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {filtered.length} of {items.length}</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
