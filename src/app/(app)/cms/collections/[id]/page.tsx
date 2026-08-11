'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Loader2, Settings, Boxes, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ConfirmDialog';
import { errorMessage } from '@/lib/errors';
import { statusDescription, statusLabel } from '@/lib/content-status';
import { EmptyState } from '@/components/EmptyState';
import { createClient } from '@/lib/supabase/client';
import type { Collection, CollectionItem } from '@/lib/supabase/types';
import SortableList from '@/components/builder/SortableList';

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
  const confirm = useConfirm();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items,      setItems]      = useState<CollectionItem[]>([]);
  const [creating,   setCreating]   = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
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

    if (err) { setError(errorMessage(err, { entity: 'entry' })); return; }
    router.push(`/cms/collections/${collection.id}/entries/${created.id}`);
  }

  async function handleDelete(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    const name = item?.slug || 'this entry';
    const isLive = item?.status === 'published';

    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: 'This permanently removes the entry. It cannot be undone.',
      consequences: isLive
        ? ['This entry is published, so it will disappear from your website.']
        : ['This entry is not published, so nothing on your website will change.'],
      confirmLabel: 'Delete entry',
    });
    if (!ok) return;

    setDeleting(itemId);
    const supabase = createClient();
    const { error: err } = await supabase.from('collection_items').delete().eq('id', itemId);
    setDeleting(null);
    if (err) { setError(errorMessage(err, { entity: 'entry', action: 'delete' })); return; }
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    toast.success(`"${name}" was deleted.`);
  }

  async function handleDuplicate(item: CollectionItem) {
    setDuplicating(item.id);
    setError('');
    const supabase = createClient();
    const maxSort = items.reduce((max, current) => Math.max(max, current.sort_order), -1);
    const copyNumber = items.reduce((max, current) => {
      const match = new RegExp(`^${item.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-copy-(\\d+)$`).exec(current.slug);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
    const { data: created, error: duplicateError } = await supabase
      .from('collection_items')
      .insert({
        collection_id: item.collection_id,
        client_id: item.client_id,
        slug: `${item.slug}-copy-${copyNumber}`,
        status: 'draft',
        data: item.data,
        sort_order: maxSort + 1,
      })
      .select()
      .single();
    setDuplicating(null);
    if (duplicateError) {
      setError(errorMessage(duplicateError, { entity: 'entry', action: 'save' }));
      return;
    }
    toast.success(`Duplicated “${deriveTitle(item, collection?.options?.title_field)}” as a draft.`);
    router.push(`/cms/collections/${item.collection_id}/entries/${created.id}`);
  }

  async function reorderItems(next: CollectionItem[]) {
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
    const results = await Promise.all(
      next.map((item, i) => supabase.from('collection_items').update({ sort_order: i }).eq('id', item.id))
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(errorMessage(failed.error, { entity: 'entry', action: 'save' }));
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
  if (collection.storage !== 'generic' || collection.client_id === null) {
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

        <div className="entry-sort-list">
          {items.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={`No ${collection.name.toLowerCase()} yet`}
              body="Start from a blank entry. Once it exists, you can duplicate it as a reusable starting point for similar content."
              actionLabel={`Add your first ${collection.name_singular?.toLowerCase() || 'entry'}`}
              onAction={handleNewEntry}
            />
          ) : (
            <>
              <div className="entry-sort-header"><span>Entry</span><span>Status</span><span>Updated</span><span /></div>
              <SortableList
                items={items}
                getId={(item) => item.id}
                getLabel={(item) => deriveTitle(item, titleField)}
                onReorder={reorderItems}
                renderItem={(item) => (
                  <div className="entry-sort-row">
                    <span>
                      <Link href={`/cms/collections/${collection.id}/entries/${item.id}`}>{deriveTitle(item, titleField)}</Link>
                      <small>/{item.slug}</small>
                    </span>
                    <span><span className={`status-pill ${item.status}`} title={statusDescription(item.status)}>{statusLabel(item.status)}</span></span>
                    <span className="entry-updated">{fmtDate(item.updated_at)}</span>
                    <span className="entry-row-actions">
                    <button onClick={() => handleDuplicate(item)} disabled={duplicating === item.id} aria-label={`Duplicate ${deriveTitle(item, titleField)}`} title="Duplicate as draft">
                      {duplicating === item.id ? <Loader2 size={15} style={{ animation: 'spin .6s linear infinite' }} /> : <Copy size={15} />}
                    </button>
                    <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id} aria-label={`Delete ${deriveTitle(item, titleField)}`}>
                      {deleting === item.id ? <Loader2 size={15} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={15} />}
                    </button>
                    </span>
                  </div>
                )}
              />
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
