'use client';

import type { ReactNode } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

/**
 * The "N selected — do this to all of them" bar, shared by the content lists.
 *
 * Appears only while something is selected, rather than sitting permanently
 * disabled above every list: a row of greyed-out destructive buttons is visual
 * noise for the 95% of visits that are not a bulk operation, and it makes the
 * moment something *is* selected less obvious.
 *
 * The delete button is always last and always separated from the rest by the
 * layout, so the muscle memory for "publish these" never lands on "delete
 * these". `busy` disables everything at once — a half-applied bulk action is
 * confusing enough without letting a second one start on top of it.
 */
export function BulkActionBar({
  count,
  busy,
  onClear,
  onDelete,
  deleteLabel = 'Delete',
  children,
}: {
  count: number;
  busy: boolean;
  onClear: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  /** Non-destructive actions, rendered before Delete. */
  children?: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="entry-bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{count} selected</strong>
      {busy && <Loader2 size={13} className="spin" style={{ color: 'var(--ne-blue)' }} />}
      {/* A disabled fieldset disables every control inside it, including the
          caller's own actions. Callers still pass `disabled={busy}` on their
          buttons for the visual state, but this is what guarantees a second
          bulk action cannot start on top of one already running — a caller
          who forgets that prop no longer opens the hole. `display: contents`
          keeps the fieldset out of the flex layout entirely. */}
      <fieldset disabled={busy} style={{ display: 'contents', border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        {children}
        {onDelete && (
          <button className="btn-outline-ne entry-bulk-delete" onClick={onDelete} disabled={busy}>
            <Trash2 size={13} /> {deleteLabel}
          </button>
        )}
        <button className="entry-bulk-clear" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </fieldset>
    </div>
  );
}

/** A checkbox cell, so every list's selection control is the same size and label shape. */
export function SelectCell({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <span className="entry-select">
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={label} />
    </span>
  );
}
