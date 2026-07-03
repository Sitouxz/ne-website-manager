'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Loader2, Settings,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Collection, CollectionItem } from '@/lib/supabase/types';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Derives the display title for an entry: `data[title_field]` if the
 * collection has one configured and the entry actually has a value for it,
 * else the entry's `slug` — there is no denormalized title column on
 * `collection_items` (see `supabase/migrations/007_document_existing_collections_schema.sql`). */
function deriveTitle(item: CollectionItem, titleField: string | undefined): string {
  if (titleField) {
    const value = item.data?.[titleField];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return item.slug || '(untitled)';
}

/**
 * Entries list for a `storage='generic'` collection — Task 4.3. Mirrors
 * `cms/pages/page.tsx`'s list conventions (delete-with-confirm, thin
 * "New Entry" create-then-redirect matching `cms/posts/new/page.tsx`) plus
 * `[id]/schema/page.tsx`'s up/down move-button reordering (rather than
 * drag-and-drop — same "nice to have, not required" call Task 4.2 already
 * made for field reordering, applied here to entry `sort_order`).
 *
 * Unlike the schema builder (`ne_admin`-only), entry management has no
 * client-side role gate: `collection_items` RLS (migration 007) is `FOR ALL
 * USING (client_id = my_client_id() OR is_ne_admin())` with no
 * `client_admin`-only restriction (migration 008 explicitly scoped its
 * write-lockdown fix to `collections` only, leaving `collection_items` as
 * "any authenticated user of the client can write" — the same model
 * posts/pages/properties already use), so this page follows that same
 * open-to-any-role convention.
 */
export default function CollectionEntriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items,      setItems]      = useState<CollectionItem[]>([]);
  const [creating,   setCreating]   = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [error,      setError]      = useState('');
  const [clientId,   setClientId]   = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    const supabase = createClient();

    const { data: coll } = await supabase.from('collections').select('*').eq('id', id).single();
    setCollection((coll as Collection) ?? null);

    if (coll) {
      const { data: rows } = await supabase
        .from('collection_items')
        .select('*')
        .eq('collection_id', id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      setItems((rows ?? []) as CollectionItem[]);
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('client_id, role').eq('id', user.id).single();
      setClientId(profile?.role === 'ne_admin' ? (coll?.client_id ?? null) : (profile?.client_id ?? null));
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchData(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchData]);

  async function handleNewEntry() {
    if (!collection) return;
    const cid = clientId ?? collection.client_id;
    if (!cid) { setError('No client linked to this collection.'); return; }

    setCreating(true);
    setError('');
    const supabase = createClient();
    const maxSort = items.reduce((max, i) => Math.max(max, i.sort_order), -1);
    const { data: created, error: err } = await supabase
      .from('collection_items')
      .insert({
        collection_id: collection.id,
        client_id: cid,
        slug: `untitled-${Date.now()}`,
        status: 'draft',
        data: {},
        sort_order: maxSort + 1,
      })
      .select()
      .single();
    setCreating(false);

    if (err) { setError(err.message); return; }
    router.push(`/cms/collections/${collection.id}/entries/${created.id}`);
  }

  async function handleDelete(itemId: string) {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    setDeleting(itemId);
    const supabase = createClient();
    const { error: err } = await supabase.from('collection_items').delete().eq('id', itemId);
    setDeleting(null);
    if (err) { setError(err.message); return; }
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  async function moveItem(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);

    // Persist EVERY item's sort_order as its new array index, not just the
    // two swapped rows. Writing only the swapped pair would assume every
    // other row's `sort_order` already exactly equals its position in this
    // list — true right after creation (new entries get `maxSort + 1`,
    // fetched back in ascending `sort_order` order) but not an invariant
    // this component can safely assume holds forever (e.g. after a delete
    // leaves a gap). Rewriting the whole list on every move keeps
    // `sort_order === array index` true unconditionally, at the cost of up
    // to N writes per move — an acceptable tradeoff for collection sizes
    // this UI is meant for.
    const supabase = createClient();
    await Promise.all(
      next.map((item, i) => supabase.from('collection_items').update({ sort_order: i }).eq('id', item.id))
    );
  }

  if (loading) {
    return (
      <>
        <Topbar title="Collection" subtitle="Loading..." />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  if (!collection) {
    return (
      <>
        <Topbar title="Collection" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Collection not found.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne"><ArrowLeft size={14} /> Back to Collections</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Defends against a stale/guessed URL the same way the schema page does —
  // native (posts/pages/properties-backed) and global collections have no
  // `collection_items` entry-editing flow; this route is generic-only.
  if (collection.storage !== 'generic') {
    return (
      <>
        <Topbar title={collection.name} subtitle="Entries" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Entry management isn&apos;t available for {collection.client_id === null ? 'global/system' : 'native'} collections.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne"><ArrowLeft size={14} /> Back to Collections</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const titleField = collection.options?.title_field;

  return (
    <>
      <Topbar title={collection.name} subtitle={`${items.length} ${items.length === 1 ? collection.name_singular : collection.name}`} />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <Link href="/cms/collections" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Collections
          </Link>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href={`/cms/collections/${collection.id}/schema`} className="btn-outline-ne">
              <Settings size={14} /> Edit Schema
            </Link>
            <button className="btn-ne" onClick={handleNewEntry} disabled={creating}>
              {creating ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
              New {collection.name_singular || 'Entry'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {collection.fields.length === 0 && (
          <div style={{ padding: '10px 14px', background: 'var(--surface-2)', color: 'var(--fg2)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
            This collection has no fields defined yet. <Link href={`/cms/collections/${collection.id}/schema`} style={{ color: 'var(--ne-blue)', fontWeight: 600 }}>Add fields</Link> before creating entries.
          </div>
        )}

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}></th>
                  <th style={{ paddingLeft: 0 }}>Title</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      No entries yet. Create your first one!
                    </td>
                  </tr>
                ) : items.map((item, i) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <button
                          onClick={() => moveItem(i, -1)}
                          disabled={i === 0}
                          aria-label="Move up"
                          style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveItem(i, 1)}
                          disabled={i === items.length - 1}
                          aria-label="Move down"
                          style={{ background: 'none', border: 'none', cursor: i === items.length - 1 ? 'default' : 'pointer', color: i === items.length - 1 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </td>
                    <td style={{ paddingLeft: 0 }}>
                      <Link href={`/cms/collections/${collection.id}/entries/${item.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                        {deriveTitle(item, titleField)}
                      </Link>
                      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 1 }}>/{item.slug}</div>
                    </td>
                    <td><span className={`status-pill ${item.status}`}>{item.status}</span></td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDate(item.updated_at)}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deleting === item.id}
                        aria-label={`Delete ${deriveTitle(item, titleField)}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6 }}
                      >
                        {deleting === item.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
