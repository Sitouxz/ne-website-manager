'use client';

import Topbar from '@/components/Topbar';
import { useEffect, useRef, useState } from 'react';
import { Search, UploadCloud, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!window.confirm(`Delete "${item.filename ?? 'this file'}"? This cannot be undone.`)) return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/media?id=${item.id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setTotalCount((c) => Math.max(0, c - 1));
      } else {
        const json = await res.json().catch(() => ({}));
        alert(json.error ?? 'Failed to delete media');
      }
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
    if (error) { alert(error.message); return; }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, alt } : i)));
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
          <MediaGrid items={filtered} onDelete={handleDelete} onSaveAlt={handleSaveAlt} deletingId={deletingId} />
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
