'use client';

import { ArrowLeft, Loader2 } from 'lucide-react';
import type { FieldChange } from '@/lib/revisions/diff';

interface RevisionCompareProps {
  savedAt: string;
  authorName?: string;
  changes: FieldChange[];
  restoring: boolean;
  onBack: () => void;
  onRestore: () => void;
}

const addedStyle = { background: '#DCFCE7', color: '#14532D', textDecoration: 'underline', textDecorationColor: '#16A34A', borderRadius: 2 } as const;
const removedStyle = { background: '#FEE2E2', color: '#7F1D1D', textDecoration: 'line-through', borderRadius: 2 } as const;

/**
 * "What changed since this version" — rendered inside the history drawer in
 * place of the list, so it inherits the drawer's layering and focus instead
 * of stacking a second modal on top of it. Additions and removals are marked
 * with underline/strike-through and screen-reader text, never colour alone.
 */
export function RevisionCompare({ savedAt, authorName, changes, restoring, onBack, onRestore }: RevisionCompareProps) {
  const savedLabel = new Date(savedAt).toLocaleString();

  return (
    <section aria-labelledby="revision-compare-title" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" className="btn-outline-ne" onClick={onBack} style={{ alignSelf: 'flex-start', fontSize: 12, padding: '5px 10px' }}>
        <ArrowLeft size={13} aria-hidden="true" /> All versions
      </button>

      <header>
        <h3 id="revision-compare-title" style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: 'var(--fg1)' }}>
          Changes since {savedLabel}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg3)', lineHeight: 1.5 }}>
          {authorName ? `Saved by ${authorName}. ` : ''}
          <span style={addedStyle}>Underlined</span> text was added since then;{' '}
          <span style={removedStyle}>struck-through</span> text was removed. Restoring brings that version back.
        </p>
      </header>

      {changes.length === 0 ? (
        <p style={{ margin: 0, padding: '18px 12px', fontSize: 13, color: 'var(--fg2)', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)' }}>
          No differences. This version matches what you have now.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {changes.map((change) => (
            <li key={change.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--fg2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                {change.label}
              </div>
              <ChangeBody change={change} />
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn-ne" onClick={onRestore} disabled={restoring || changes.length === 0} style={{ alignSelf: 'flex-start' }}>
        {restoring ? <Loader2 size={13} className="spin" aria-hidden="true" /> : null}
        Restore this version
      </button>
    </section>
  );
}

function ChangeBody({ change }: { change: FieldChange }) {
  if (change.kind === 'list') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12.5 }}>
        {(change.added ?? []).map((item) => (
          <span key={`a-${item}`} style={{ ...addedStyle, padding: '1px 6px' }}><span className="sr-only">Added: </span>{item}</span>
        ))}
        {(change.removed ?? []).map((item) => (
          <span key={`r-${item}`} style={{ ...removedStyle, padding: '1px 6px' }}><span className="sr-only">Removed: </span>{item}</span>
        ))}
      </div>
    );
  }

  if (change.segments) {
    return (
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--fg1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {change.segments.map((segment, index) => {
          if (segment.type === 'added') return <ins key={index} style={addedStyle}><span className="sr-only">[added] </span>{segment.text}</ins>;
          if (segment.type === 'removed') return <del key={index} style={removedStyle}><span className="sr-only">[removed] </span>{segment.text}</del>;
          return <span key={index}>{segment.text}</span>;
        })}
      </p>
    );
  }

  if (change.tooLarge) {
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg2)' }}>
        Changed substantially ({change.before.length.toLocaleString()} → {change.after.length.toLocaleString()} characters). Too long to show word by word.
      </p>
    );
  }

  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 12.5, overflowWrap: 'anywhere' }}>
      <dt style={{ color: 'var(--fg3)' }}>Then</dt>
      <dd style={{ margin: 0, color: 'var(--fg1)' }}>{change.before || <em style={{ color: 'var(--fg3)' }}>Empty</em>}</dd>
      <dt style={{ color: 'var(--fg3)' }}>Now</dt>
      <dd style={{ margin: 0, color: 'var(--fg1)' }}>{change.after || <em style={{ color: 'var(--fg3)' }}>Empty</em>}</dd>
    </dl>
  );
}
