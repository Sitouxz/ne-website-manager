'use client';

import { useState } from 'react';
import { Trash2, Copy, Check, FileText, Film, File as FileIcon, Loader2 } from 'lucide-react';
import type { MediaItem } from '@/app/api/media/route';
import SuggestButton from './SuggestButton';
import { useSuggestionsEnabled } from './AppShell';

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
  item, onSelect, onDelete, onSaveAlt, deleting, selected, onToggleSelected,
}: {
  item: MediaItem;
  onSelect?: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  onSaveAlt?: (item: MediaItem, alt: string) => void;
  deleting?: boolean;
  /** Selection is opt-in: the picker passes neither of these and shows no checkbox. */
  selected?: boolean;
  onToggleSelected?: (item: MediaItem) => void;
}) {
  const [altDraft, setAltDraft] = useState(item.alt ?? '');
  const suggestionsEnabled = useSuggestionsEnabled();
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
      <div style={{ position: 'relative', height: 120, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {onToggleSelected && (
          <label
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: 6, left: 6, zIndex: 1, display: 'grid', placeItems: 'center',
              width: 24, height: 24, borderRadius: 5, background: 'rgba(255,255,255,.92)',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)', cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelected(item)}
              aria-label={`Select ${item.filename ?? 'file'}`}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
          </label>
        )}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            <input
              value={altDraft}
              onChange={(e) => setAltDraft(e.target.value)}
              onBlur={() => { if (altDraft !== (item.alt ?? '')) onSaveAlt(item, altDraft); }}
              placeholder="Describe this picture..."
              style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', outline: 'none', color: 'var(--fg2)' }}
            />
            {/* Only for images — there is nothing to look at in a PDF, and a
                confidently wrong description is worse than a missing one. */}
            {isImage && (
              <SuggestButton
                kind="alt"
                enabled={suggestionsEnabled}
                imageUrl={item.url}
                hasExistingValue={altDraft.trim() !== ''}
                onSuggestion={(text) => {
                  // Saved immediately rather than left as a draft: this input
                  // persists on blur, and a suggestion the user never focuses
                  // would otherwise be silently discarded.
                  setAltDraft(text);
                  onSaveAlt(item, text);
                }}
              />
            )}
          </div>
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
              {deleting ? <Loader2 size={11} className="spin" /> : <Trash2 size={11} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaGrid({
  items, onSelect, onDelete, onSaveAlt, deletingId, emptyTitle, emptyBody,
  isSelected, onToggleSelected,
}: {
  items: MediaItem[];
  onSelect?: (item: MediaItem) => void;
  onDelete?: (item: MediaItem) => void;
  onSaveAlt?: (item: MediaItem, alt: string) => void;
  deletingId?: string | null;
  /** Both required together to show selection checkboxes; the picker passes neither. */
  isSelected?: (item: MediaItem) => boolean;
  onToggleSelected?: (item: MediaItem) => void;
  /** Overrides for the empty state, e.g. when a search returned nothing. */
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (items.length === 0) {
    // "No media found." read like an error. The library is more likely simply
    // empty, and the upload control is directly above this — so point at it.
    return (
      <div style={{ padding: '44px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)', marginBottom: 4 }}>
          {emptyTitle ?? 'No files yet'}
        </div>
        <p style={{ fontSize: 13, color: 'var(--fg3)', margin: '0 auto', maxWidth: 340, lineHeight: 1.6 }}>
          {emptyBody ?? 'Drag images or documents onto the box above to upload them. Once uploaded you can use them anywhere on your website.'}
        </p>
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
          selected={isSelected?.(item) ?? false}
          onToggleSelected={onToggleSelected}
        />
      ))}
    </div>
  );
}
