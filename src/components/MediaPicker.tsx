'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Search, UploadCloud, Loader2 } from 'lucide-react';
import { useSelectedClient } from '@/components/AppShell';
import { useMediaUpload } from '@/lib/hooks/useMediaUpload';
import { useMediaList } from '@/lib/hooks/useMediaList';
import { MediaGrid } from '@/components/MediaGrid';
import type { MediaItem } from '@/app/api/media/route';

// Same page size as the library page's "Load more" — media libraries can
// exceed the API's 100/request cap (see `route.ts`'s `PAGINATION`), so a
// single unpaginated fetch would make older items unreachable through the
// picker. This mirrors `cms/media/page.tsx` exactly (see `useMediaList`).
const LIMIT = 60;

/**
 * Reusable media-picker dialog, consumed by the post/property editors (Task
 * 2.2) and, per the phase plan, the future Tiptap image button (Phase 3) and
 * collections/globals editors (Phases 4-5).
 *
 * Uses the hand-rolled fixed-overlay dialog pattern already established in
 * this codebase (see `admin/page.tsx` and settings' "Generate Key" dialog),
 * not the unused shadcn `Dialog` in `components/ui/dialog.tsx` — consistency
 * with the rest of the app.
 *
 * Data fetching: this component does its own independent `GET /api/media`
 * call (rather than expecting a parent to have preloaded media) so any
 * editor can drop in `<MediaPicker />` without wiring up media state itself.
 * It (re)fetches the first page whenever `open` flips true, via the same
 * offset-paginated `useMediaList` hook the library page
 * (`cms/media/page.tsx`) uses, so a "Load more" button here behaves
 * identically (appends the next page, reads `X-Total-Count` for whether more
 * remain) — libraries over one page (100 items, the API's cap) stay fully
 * reachable through the picker, not just the most recent 100.
 * `accept="image"` is applied server-side via `?type=image` rather than a
 * client-side filter, since the API already supports it and it keeps the
 * payload smaller.
 *
 * Search only filters the currently-loaded page(s), same scope decision the
 * library page already made — "Load more" is hidden while a search term is
 * active there (searching a subset of loaded items, then loading more,
 * would be a confusing "did that load new matches or not?" interaction), so
 * this mirrors that rather than inventing a different rule.
 */
export default function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  accept = 'all',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: MediaItem) => void;
  accept?: 'image' | 'all';
}) {
  const { selectedClientId } = useSelectedClient();
  const {
    items, setItems,
    loading, error: loadError,
    fetchPage, loadMore, canLoadMore,
  } = useMediaList({
    clientId: selectedClientId,
    type: accept === 'image' ? 'image' : undefined,
    limit: LIMIT,
  });
  const [search,    setSearch]    = useState('');
  const [dragOver,  setDragOver]  = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploading, error: uploadError, uploadFiles } = useMediaUpload(selectedClientId);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => fetchPage(0, false), 0);
    return () => window.clearTimeout(timer);
  }, [open, fetchPage]);

  async function handleFiles(files: FileList | File[]) {
    const uploaded = await uploadFiles(files);
    if (uploaded.length > 0) setItems((prev) => [...uploaded, ...prev]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  function handleSelect(item: MediaItem) {
    onSelect(item);
    onOpenChange(false);
  }

  if (!open) return null;

  const filtered = items.filter((i) =>
    (i.filename ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => onOpenChange(false)}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          padding: '24px 28px', width: 760, maxWidth: '92vw', maxHeight: '86vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Select {accept === 'image' ? 'an Image' : 'Media'}</div>
          <button onClick={() => onOpenChange(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px' }}>
            <Search size={14} color="var(--fg3)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by filename..."
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
            />
          </div>
          <button className="btn-outline-ne" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <UploadCloud size={14} />}
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept === 'image' ? 'image/*' : undefined}
            hidden
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {uploadError && (
          <div style={{ padding: '8px 12px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 12.5, marginBottom: 10 }}>
            {uploadError}
          </div>
        )}
        {loadError && (
          <div style={{ padding: '8px 12px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 12.5, marginBottom: 10 }}>
            {loadError}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            flex: 1, overflowY: 'auto', padding: 4, borderRadius: 'var(--r-sm)',
            border: dragOver ? '2px dashed var(--ne-blue)' : '2px dashed transparent',
            background: dragOver ? 'var(--ne-blue-bg)' : 'transparent',
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={20} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
            </div>
          ) : (
            <>
              <MediaGrid items={filtered} onSelect={handleSelect} />
              {!search && canLoadMore && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <button className="btn-outline-ne" onClick={loadMore}>
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
