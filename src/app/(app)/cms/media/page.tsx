'use client';

import Topbar from '@/components/Topbar';
import { useEffect, useRef, useState } from 'react';
import { Search, UploadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { useConfirm } from '@/components/ConfirmDialog';
import { errorMessage } from '@/lib/errors';
import { describeUsage, type MediaUsage } from '@/lib/media/usage';
import { firePublishNotify } from '@/lib/publish-client';
import type { MediaUsageResponse } from '@/app/api/media/usage/route';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { useMediaList } from '@/lib/hooks/useMediaList';
import { MediaGrid } from '@/components/MediaGrid';
import type { MediaItem } from '@/app/api/media/route';

// Load a generous page at a time — media libraries can grow large (API caps
// at 100/request), but a "Load more" button covers the rest without adding
// full pagination UI, which is out of scope for this task.
const LIMIT = 60;

export default function MediaLibraryPage() {
  // `selectedClientId` comes from AppLayout (cookie-selected client for
  // ne_admin, own `profiles.client_id` otherwise) — the same per-client
  // scoping every other cms/* list page (posts, properties) already uses,
  // rather than re-deriving admin/client state locally the way
  // settings/page.tsx does. Passing it through as `client_id` on every
  // request is safe either way: the API requires it for ne_admin and
  // silently ignores it for anyone else (see route.ts `resolveClientId`).
  const { selectedClientId } = useSelectedClient();

  const {
    items, setItems,
    totalCount, setTotalCount,
    loading, error: loadError,
    fetchPage, loadMore, canLoadMore,
  } = useMediaList({ clientId: selectedClientId, limit: LIMIT, initialLoading: true });
  const [search,      setSearch]      = useState('');
  const [dragOver,    setDragOver]    = useState(false);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  // Set while the "where is this used?" lookup runs, before the confirm
  // dialog opens — the grid shows the same spinner as a delete, so the click
  // never feels like it did nothing.
  const [checkingUsageId, setCheckingUsageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const { uploading, error: uploadError, uploadFiles } = useMediaUpload(selectedClientId);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchPage(0, false), 0);
    return () => window.clearTimeout(timer);
  }, [fetchPage]);

  async function handleFiles(files: FileList | File[]) {
    const uploaded = await uploadFiles(files);
    if (uploaded.length > 0) {
      setItems((prev) => [...uploaded, ...prev]);
      setTotalCount((c) => c + uploaded.length);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  async function handleDelete(item: MediaItem) {
    const name = item.filename ?? 'this file';

    // Look up where the file is actually used BEFORE asking. Someone deleting
    // an image has no way of remembering which of forty pages it sits on, and
    // a warning that only says "cannot be undone" doesn't help them decide.
    setCheckingUsageId(item.id);
    let consequences: string[];
    let usages: MediaUsage[] = [];
    try {
      const params = new URLSearchParams({ id: item.id });
      if (selectedClientId) params.set('client_id', selectedClientId);
      const res = await fetch(`/api/media/usage?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as MediaUsageResponse;
      usages = body.usages;
      consequences = describeUsage(body.usages);
      if (body.truncated) {
        consequences.push('You have a lot of content, so there may be other uses not listed here.');
      }
    } catch {
      // A failed lookup must not block the delete — but it must not pretend
      // the file is unused either.
      consequences = ["We couldn't check where this file is used, so it may still be on your website."];
    } finally {
      setCheckingUsageId(null);
    }

    const ok = await confirm({
      title: `Delete "${name}"?`,
      body: 'This permanently removes the file. It cannot be undone.',
      consequences,
      confirmLabel: 'Delete file',
    });
    if (!ok) return;

    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/media?id=${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setTotalCount((c) => Math.max(0, c - 1));

        // Deleting a file used on a live page leaves a broken image there
        // until something revalidates. Nothing did. We already know exactly
        // which pages were affected from the usage lookup above, so only
        // notify when at least one of them was actually live — deleting an
        // unused file shouldn't trigger a rebuild of the client's site.
        if (selectedClientId && usages.some((u) => u.isLive)) {
          firePublishNotify({
            clientId: selectedClientId,
            event: 'content.updated',
            entityType: 'media',
            entityId: item.id,
            slug: item.filename,
            path: null,
          });
        }

        toast.success(`"${name}" was deleted.`);
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(errorMessage(json?.error ?? new Error('delete failed'), { entity: 'image', action: 'delete' }));
      }
    } catch (err) {
      toast.error(errorMessage(err, { entity: 'image', action: 'delete' }));
    } finally {
      setDeletingId(null);
    }
  }

  // No PATCH endpoint exists for media (Task 2.1's route only does
  // POST/GET/DELETE) — alt text is a plain column update, so this goes
  // straight through the RLS-scoped client the same way posts/properties
  // editors write simple field updates directly via `supabase.from(...)`.
  async function handleSaveAlt(item: MediaItem, alt: string) {
    const supabase = createClient();
    const { error } = await supabase.from('media').update({ alt }).eq('id', item.id);
    if (error) { toast.error(errorMessage(error, { entity: 'image' })); return; }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, alt } : i)));
    toast.success('Description saved.');
  }

  const filtered = items.filter((i) =>
    (i.filename ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Topbar title="Media Library" subtitle={`${totalCount} file${totalCount === 1 ? '' : 's'}`} />
      <div className="page-body">

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--ne-blue)' : 'var(--border)'}`,
            background: dragOver ? 'var(--ne-blue-bg)' : 'var(--surface)',
            borderRadius: 'var(--r-md)', padding: '28px 20px', textAlign: 'center',
            cursor: 'pointer', marginBottom: 20, transition: 'background .15s, border-color .15s',
          }}
        >
          {uploading ? (
            <Loader2 size={22} color="var(--ne-blue)" style={{ margin: '0 auto 8px', animation: 'spin .6s linear infinite' }} />
          ) : (
            <UploadCloud size={22} color="var(--fg3)" style={{ margin: '0 auto 8px' }} />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg2)', marginBottom: 2 }}>
            {uploading ? 'Uploading...' : 'Drag & drop files here, or click to browse'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>Images, video/mp4, or PDF · up to 25 MB each</div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {uploadError && (
          <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
            {uploadError}
          </div>
        )}
        {loadError && (
          <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
            {loadError}
          </div>
        )}

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 14px', maxWidth: 340 }}>
          <Search size={14} color="var(--fg3)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename..."
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 size={22} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
          </div>
        ) : (
          <MediaGrid
            items={filtered}
            onDelete={handleDelete}
            onSaveAlt={handleSaveAlt}
            deletingId={deletingId ?? checkingUsageId}
            emptyTitle={items.length > 0 ? 'No matching files' : undefined}
            emptyBody={items.length > 0 ? 'Nothing here matches what you searched for. Try a different word.' : undefined}
          />
        )}

        {!loading && !search && canLoadMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
            <button className="btn-outline-ne" onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
