'use client';

import { AlertCircle } from 'lucide-react';
import { summarizeWarnings, type PublishWarning } from '@/lib/publish-checks';

/**
 * The publish preflight panel, shared by the post, page and collection-entry
 * editors so all three say the same thing in the same voice.
 *
 * Amber, not red: none of these stop a publish, and a red panel above the
 * editor reads as "you have done something wrong" for what is really "here is
 * what your readers will experience". The last line says so explicitly,
 * because a warning with no stated way past it is indistinguishable from a
 * block to someone who has never seen one before.
 *
 * `role="status"` rather than `role="alert"`: this appears in response to the
 * user's own click, so it does not need to interrupt a screen reader mid-
 * sentence the way a genuine error would.
 */
export function PublishWarnings({ warnings }: { warnings: PublishWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      style={{
        marginBottom: 16,
        background: '#FFF7E8',
        border: '1px solid #F5D9A8',
        borderRadius: 'var(--r-md)',
        padding: '14px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AlertCircle size={15} color="#B45309" />
        <strong style={{ fontSize: 13, color: '#7C4A03' }}>
          {summarizeWarnings(warnings)} before this goes live
        </strong>
      </div>
      <ul style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {warnings.map((warning, i) => (
          <li key={i} style={{ fontSize: 12.5, color: '#7C4A03', lineHeight: 1.45 }}>
            {warning.message}
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 12, color: '#7C4A03', marginTop: 10 }}>
        None of these stop you publishing — press the publish button again to go ahead.
      </div>
    </div>
  );
}
