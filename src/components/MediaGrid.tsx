'use client';

import { useState } from 'react';
import { Trash2, Copy, Check, FileText, Film, File as FileIcon, Loader2 } from 'lucide-react';
import type { MediaItem } from '@/app/api/media/route';

/**
 * Grid rendering shared by the Media Library page (`cms/media/page.tsx`) and
 * `MediaPicker`. The two consumers differ only in which callbacks they wire
 * up: the library page passes `onDelete`/`onSaveAlt` for management, the
 * picker passes `onSelect` to let clicking a card choose it.
 */

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ mimeType }: { mimeType: string | null }) {
  if (mimeType?.startsWith('video/')) return <Film size={28} color="var(--fg3)" />;
  if (mimeType === 'application/pdf') return <FileText size={28} color="var(--fg3)" />;
  return <FileIcon size={28} color="var(--fg3)" />;
}

function MediaGridCard({
  item, onSelect, onDelete, onSaveAlt, deleting,
}: {
  item: MediaItem;
  onSelect?: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  onSaveAlt?: (item: MediaItem, alt: string) => void;
  deleting?: boolean;
}) {
  const [altDraft, setAltDraft] = useState(item.alt ?? '');
  const [copied, setCopied] = useState(false);
  const isImage = item.mime_type?.startsWith('image/') ?? false;

  function copyUrl(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(item.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden',
        background: 'var(--surface)', display: 'flex', flexDirection: 'column',
        cursor: onSelect ? 'pointer' : 'default',
      }}
      onClick={onSelect ? () => onSelect(item) : undefined}
    >
      <div style={{ height: 120, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <FileTypeIcon mimeType={item.mime_type} />
        )}
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={item.filename ?? undefined}
        >
          {item.filename ?? 'Untitled'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{formatBytes(item.size_bytes)}</div>

        {onSaveAlt && (
          <input
            value={altDraft}
            onChange={(e) => setAltDraft(e.target.value)}
            onBlur={() => { if (altDraft !== (item.alt ?? '')) onSaveAlt(item, altDraft); }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Alt text..."
            style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', color: 'var(--fg2)' }}
          />
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            onClick={copyUrl}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              fontSize: 11, fontWeight: 600, color: 'var(--fg3)', background: 'none',
              border: '1px solid var(--border)', borderRadius: 4, padding: '5px 6px', cursor: 'pointer',
            }}
          >
            {copied ? <><Check size={11} color="var(--ne-success)" /> Copied</> : <><Copy size={11} /> Copy URL</>}
          </button>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(item); }}
              disabled={deleting}
              title="Delete"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: 'var(--ne-danger)', background: 'none',
                border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer',
              }}
            >
              {deleting ? <Loader2 size={11} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={11} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaGrid({
  items, onSelect, onDelete, onSaveAlt, deletingId,
}: {
  items: MediaItem[];
  onSelect?: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  onSaveAlt?: (item: MediaItem, alt: string) => void;
  deletingId?: string | null;
}) {
  if (items.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
        No media found.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
      {items.map((item) => (
        <MediaGridCard
          key={item.id}
          item={item}
          onSelect={onSelect}
          onDelete={onDelete}
          onSaveAlt={onSaveAlt}
          deleting={deletingId === item.id}
        />
      ))}
    </div>
  );
}
