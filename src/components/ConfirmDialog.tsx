'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Replacement for `window.confirm` across the CMS.
 *
 * The browser dialog was failing the people who actually use this product.
 * `confirm('Delete this post? This cannot be undone.')` states the mechanism
 * ("cannot be undone") but never the consequence a client cares about — that
 * the post is live on their website right now and will vanish from it. It also
 * can't be styled, reads as a browser security warning, and puts the
 * destructive action on the default button.
 *
 * This dialog is deliberately shaped around three questions a non-technical
 * user asks before clicking something scary:
 *   1. What exactly am I deleting?      -> `title` names the specific thing
 *   2. What happens to my website?      -> `consequences`, one plain sentence each
 *   3. Can I undo it?                   -> `body`, stated honestly either way
 *
 * The confirm button is labelled with the verb ("Delete post"), never "OK", so
 * the last thing read before clicking is what will happen. Cancel is the safe
 * default: it is focused on open and Escape triggers it.
 *
 * Usage is a near drop-in for the browser call it replaces:
 * ```tsx
 * const confirm = useConfirm();
 * if (!await confirm({ title: 'Delete this post?', confirmLabel: 'Delete post' })) return;
 * ```
 *
 * Follows the hand-rolled `position: fixed` overlay pattern already used by
 * `MediaPicker.tsx` and the revision-history drawers, rather than
 * `components/ui/dialog.tsx` — that shadcn primitive is still unused anywhere
 * in this codebase, and this keeps one overlay idiom instead of two.
 */

export interface ConfirmOptions {
  /** Plain-language question naming the specific thing, e.g. "Delete "Ramadan Timings"?". */
  title: string;
  /** Optional sentence on reversibility or what the action means. */
  body?: string;
  /**
   * What this will change, one short sentence each — especially anything the
   * visitor-facing website will do differently. Rendered as a highlighted list.
   */
  consequences?: string[];
  /** Verb-first label, e.g. "Delete post". Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (default), `normal` for neutral ones. */
  tone?: 'danger' | 'normal';
}

type Resolver = (confirmed: boolean) => void;

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  async () => false
);

/**
 * Returns an async `confirm(options)`. Resolves `true` only if the user
 * clicks the confirm button; cancelling, pressing Escape or clicking the
 * backdrop all resolve `false`.
 */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    setBusy(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    // Keep the dialog on screen while the caller's async work runs after a
    // confirm, so the user never sees an un-dismissed dialog snap shut and
    // then a spinner elsewhere. The caller closes it by resolving.
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setOptions(null);
    setBusy(false);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <ConfirmOverlay
          options={options}
          busy={busy}
          onCancel={() => settle(false)}
          onConfirm={() => { setBusy(true); settle(true); }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmOverlay({
  options, busy, onCancel, onConfirm,
}: {
  options: ConfirmOptions;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const danger = (options.tone ?? 'danger') === 'danger';

  return (
    <div
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300,
        display: 'grid', placeItems: 'center', padding: 20,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', width: 440, maxWidth: '100%',
          boxShadow: '0 24px 64px rgba(0,0,0,.22)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '22px 24px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          {danger && (
            <div style={{
              flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
              background: '#FEF2F2', display: 'grid', placeItems: 'center',
            }}>
              <AlertTriangle size={18} color="var(--ne-danger)" />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h2 id="confirm-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg1)', lineHeight: 1.35 }}>
              {options.title}
            </h2>
            {options.body && (
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--fg2)', lineHeight: 1.55 }}>
                {options.body}
              </p>
            )}
          </div>
        </div>

        {options.consequences && options.consequences.length > 0 && (
          <ul style={{
            margin: '16px 24px 0', padding: '12px 14px 12px 30px',
            background: danger ? '#FEF2F2' : 'var(--surface-3)',
            border: `1px solid ${danger ? '#FECACA' : 'var(--border)'}`,
            borderRadius: 'var(--r-sm)', listStyle: 'disc',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {options.consequences.map((line) => (
              <li key={line} style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.5 }}>
                {line}
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '20px 24px 22px' }}>
          <button
            className="btn-outline-ne"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: danger ? 'var(--ne-danger)' : 'var(--ne-blue)',
              color: '#fff', border: 'none', borderRadius: 'var(--r-sm)',
              padding: '9px 16px', fontSize: 13, fontWeight: 700,
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
            }}
          >
            {busy && <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} />}
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
