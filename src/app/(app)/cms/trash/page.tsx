'use client';

import Topbar from '@/components/Topbar';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { useConfirm } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { firePublishNotify, computeLivePath } from '@/lib/publish-client';
import { errorMessage } from '@/lib/errors';
import {
  TRASH_RETENTION_DAYS,
  daysUntilPurge,
  entityNoun,
  restoreFromTrash,
  trashErrorMessage,
  type TrashEntityType,
  type TrashRow,
} from '@/lib/trash';

const TYPE_LABEL: Record<TrashEntityType, string> = {
  post: 'Blog post',
  page: 'Page',
  property: 'Property',
  collection_entry: 'Collection entry',
};

/** Where a restored item opens, so "Restored" can link straight to it. */
function editorHref(item: TrashRow): string {
  const snap = item.snapshot;
  switch (item.entity_type) {
    case 'post': return `/cms/posts/${item.entity_id}`;
    case 'page': return `/cms/pages/${item.entity_id}`;
    case 'property': return `/cms/properties/${item.entity_id}`;
    case 'collection_entry': return `/cms/collections/${String(snap.collection_id ?? '')}/entries/${item.entity_id}`;
  }
}

/** Whether the item was visible on the website when it was trashed. */
function wasLive(item: TrashRow): boolean {
  const status = item.snapshot.status;
  if (item.entity_type === 'property') return status === 'active';
  if (item.entity_type === 'page') return status === 'published' && item.snapshot.visibility !== 'private';
  return status === 'published';
}

function deletedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Permanent deletion is admin-only (enforced by a trigger in migration
  // 029); this only decides whether to offer the button at all.
  const [canPurge, setCanPurge] = useState(false);
  const { selectedClientId } = useSelectedClient();
  const confirm = useConfirm();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const supabase = createClient();
    let query = supabase.from('trash').select('*').order('deleted_at', { ascending: false });
    if (selectedClientId) query = query.eq('client_id', selectedClientId);
    const { data, error } = await query;
    if (error) setLoadError(errorMessage(error, { entity: 'item', action: 'load' }));
    setItems((data ?? []) as TrashRow[]);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setCanPurge(profile?.role === 'ne_admin' || profile?.role === 'client_admin');
    }
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleRestore(item: TrashRow) {
    setBusyId(item.id);
    const { row, error } = await restoreFromTrash(createClient(), item.id, item.entity_type);
    setBusyId(null);
    if (error || !row) {
      toast.error(error ?? 'Could not restore this item.');
      return;
    }

    if (wasLive(item)) {
      const snap = item.snapshot;
      const slug = typeof snap.slug === 'string' ? snap.slug : null;
      const path = item.entity_type === 'post' && slug
        ? computeLivePath('post', { slug })
        : item.entity_type === 'page' && typeof snap.path === 'string'
          ? computeLivePath('page', { path: snap.path })
          : null;
      firePublishNotify({
        clientId: item.client_id,
        event: 'content.published',
        entityType: item.entity_type,
        entityId: item.entity_id,
        slug: item.entity_type === 'page' ? (snap.path as string | undefined) ?? null : slug,
        path,
      });
    }

    setItems((prev) => prev.filter((current) => current.id !== item.id));
    toast.success(`"${item.title || 'Untitled'}" restored.`, {
      action: { label: 'Open', onClick: () => { router.push(editorHref(item)); } },
    });
  }

  async function handlePurge(item: TrashRow) {
    const ok = await confirm({
      title: `Delete "${item.title || 'Untitled'}" for good?`,
      body: `This ${entityNoun(item.entity_type)} will be permanently removed and cannot be brought back.`,
      consequences: ['Its revision history is kept, but there will be nothing left to restore it onto.'],
      confirmLabel: 'Delete forever',
    });
    if (!ok) return;

    setBusyId(item.id);
    const { error } = await createClient().from('trash').delete().eq('id', item.id);
    setBusyId(null);
    if (error) {
      toast.error(trashErrorMessage(error, item.entity_type, 'delete'));
      return;
    }
    setItems((prev) => prev.filter((current) => current.id !== item.id));
    toast.success(`"${item.title || 'Untitled'}" deleted for good.`);
  }

  return (
    <>
      <Topbar title="Trash" subtitle={`${items.length} ${items.length === 1 ? 'item' : 'items'} · kept for ${TRASH_RETENTION_DAYS} days`} />
      <div className="page-body">
        <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--fg2)', maxWidth: 640, lineHeight: 1.55 }}>
          Deleted posts, pages, properties and collection entries stay here for {TRASH_RETENTION_DAYS} days, then are removed for good.
          Restoring puts an item back exactly as it was, including whether it was live.
        </p>

        {loadError ? (
          <div role="alert" style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 12 }}>
            {loadError}
          </div>
        ) : null}

        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Deleted</th>
                <th>Removed for good</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="table-placeholder">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={16} className="spin" aria-hidden="true" /> Loading trash...
                    </div>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={5} className="table-placeholder">The trash could not be loaded.</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <EmptyState
                      icon={Trash2}
                      title="The trash is empty"
                      body={`Anything you delete from posts, pages, properties or collections lands here for ${TRASH_RETENTION_DAYS} days, so a mistake can be undone.`}
                    />
                  </td>
                </tr>
              ) : items.map((item) => {
                const daysLeft = daysUntilPurge(item.deleted_at);
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600, color: 'var(--fg1)' }}>
                      {item.title || 'Untitled'}
                      {wasLive(item) ? (
                        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--fg3)' }}>Was live when deleted</span>
                      ) : null}
                    </td>
                    <td>{TYPE_LABEL[item.entity_type]}</td>
                    <td>{deletedAgo(item.deleted_at)}</td>
                    <td style={{ color: daysLeft <= 3 ? 'var(--ne-warning)' : undefined }}>
                      {daysLeft === 0 ? 'Today' : `In ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn-outline-ne" onClick={() => handleRestore(item)} disabled={busyId === item.id}>
                          {busyId === item.id ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
                          Restore
                        </button>
                        {canPurge ? (
                          <button
                            type="button"
                            className="btn-outline-ne"
                            onClick={() => handlePurge(item)}
                            disabled={busyId === item.id}
                            style={{ color: 'var(--ne-danger)' }}
                          >
                            Delete forever
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--fg3)' }}>
          Media, forms and redirects are not kept here: deleting those is still immediate.
        </p>
      </div>
    </>
  );
}
