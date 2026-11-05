'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { SuggestionKind } from '@/lib/ai/suggest';

/**
 * A small "Suggest" affordance next to a field the product already warns
 * about being empty.
 *
 * The warnings in `publish-checks.ts` are correct and actionable, and they
 * are also the ones that go unfixed — a mosque administrator told that a
 * picture has no description often does not know what a good one looks
 * like. This turns that warning into a starting point.
 *
 * ## It only ever fills the field
 *
 * `onSuggestion` hands the text to the existing form state. Nothing is
 * saved, nothing is published, and the editor can edit or clear it like
 * anything they typed. That is the same posture the publish checks take —
 * "quality is the author's call" — and it is why this is a button rather
 * than something that happens on save.
 *
 * ## It disappears when unconfigured
 *
 * `enabled` comes from the server (`isSuggestionEnabled`). When no API key
 * is set the button does not render at all, rather than rendering and
 * failing — a control that looks interactive and does nothing is the
 * specific thing the audit flagged.
 */

export interface SuggestButtonProps {
  kind: SuggestionKind;
  /** Whether the installation has suggestions configured at all. */
  enabled: boolean;
  /** Required for `kind: 'alt'` — the picture being described. */
  imageUrl?: string;
  /** What the suggestion should be about. */
  context?: { title?: string; body?: string };
  /** Called with the suggested text. Should populate the field, not save it. */
  onSuggestion: (text: string) => void;
  /** Set when the field already has content, so the label offers a rewrite. */
  hasExistingValue?: boolean;
}

export default function SuggestButton({
  kind,
  enabled,
  imageUrl,
  context,
  onSuggestion,
  hasExistingValue = false,
}: SuggestButtonProps) {
  const [loading, setLoading] = useState(false);

  if (!enabled) return null;
  if (kind === 'alt' && !imageUrl) return null;

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, imageUrl, context }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Every failure path returns a sentence written for the person
        // reading it, so there is nothing to translate here.
        toast.error(body.error ?? 'The suggestion could not be generated.');
        return;
      }

      onSuggestion(body.suggestion as string);
      toast.success('Suggestion added — edit it to suit.');
    } catch {
      toast.error('Could not reach the assistant. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="btn-outline-ne"
      style={{ fontSize: 12, padding: '4px 10px', gap: 6 }}
      title="Write a first draft you can edit. Nothing is saved until you save."
    >
      {loading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
      {loading ? 'Writing…' : hasExistingValue ? 'Suggest another' : 'Suggest'}
    </button>
  );
}
