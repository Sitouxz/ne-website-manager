'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * The screen a client sees on day one.
 *
 * Every list in the CMS previously bottomed out in a single grey sentence —
 * "No posts yet. Create your first post!" — sitting in a table cell. For a
 * non-technical user opening a section they've never used, that's a dead end:
 * it says the space is empty without saying what the space is *for*, and the
 * only way forward is to notice a button somewhere else on the page.
 *
 * This gives an empty list three things instead:
 *   1. a headline naming the space,
 *   2. one line explaining what goes here and where it shows up, and
 *   3. the action itself, as a verb.
 *
 * Two distinct cases, deliberately not merged: a genuinely empty section needs
 * an invitation, while a section emptied by a search or filter needs a way back
 * — telling someone to "write your first post" when they have forty, filtered
 * out by a stray search term, is worse than saying nothing.
 */

export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon?: LucideIcon;
  /** Names the space, e.g. "No blog posts yet". No exclamation mark. */
  title: string;
  /** One line on what belongs here and where it appears for visitors. */
  body?: string;
  /** Verb-first, e.g. "Write your first post". */
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', padding: '52px 24px', gap: 4,
    }}>
      {Icon && (
        <div style={{
          width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-3)',
          display: 'grid', placeItems: 'center', marginBottom: 10,
        }}>
          <Icon size={20} color="var(--fg3)" />
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg1)' }}>{title}</div>
      {body && (
        <p style={{ fontSize: 13, color: 'var(--fg3)', margin: 0, maxWidth: 360, lineHeight: 1.6 }}>
          {body}
        </p>
      )}
      {actionLabel && actionHref && (
        <Link href={actionHref} className="btn-ne" style={{ marginTop: 14, textDecoration: 'none' }}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button className="btn-ne" onClick={onAction} style={{ marginTop: 14 }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Shown when a list is empty only because of a search or filter. Offers the way
 * back rather than an invitation to create something.
 */
export function NoResultsState({ onClear, noun = 'items' }: { onClear?: () => void; noun?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '44px 24px', gap: 4 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)' }}>No matching {noun}</div>
      <p style={{ fontSize: 13, color: 'var(--fg3)', margin: 0, maxWidth: 340, lineHeight: 1.6 }}>
        Nothing here matches what you searched for. Try a different word, or clear the filters to see everything again.
      </p>
      {onClear && (
        <button className="btn-outline-ne" onClick={onClear} style={{ marginTop: 14 }}>
          Clear search and filters
        </button>
      )}
    </div>
  );
}
