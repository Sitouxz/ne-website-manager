/**
 * Suggestions for the two things this CMS already knows are missing.
 *
 * `publish-checks.ts` tells a mosque administrator that a picture has no
 * description and that Google will write its own summary for a page. Both
 * warnings are correct, both are actionable, and neither comes with any way
 * to act — the person reading them often does not know what good alt text
 * looks like, which is why those warnings are the ones that go unfixed.
 * This module turns each into a button.
 *
 * ## Suggestion, never automation
 *
 * Nothing here writes to the database. A suggestion is returned to the
 * editor, who accepts, edits or ignores it, and the existing save path is
 * unchanged. That is the posture `publish-checks.ts` already argues for —
 * "quality is the author's call" — and it is also what the industry landed
 * on after autonomous generation produced brand drift and duplicate meta
 * descriptions at scale.
 *
 * ## Degrades to nothing
 *
 * With no `ANTHROPIC_API_KEY` configured, `isSuggestionEnabled()` is false
 * and the buttons never render. The feature is additive: every screen works
 * exactly as it did before, and a client without the key sees no broken
 * affordance — the specific failure the audit called out.
 */

import type { FieldDef } from '@/lib/collections/types';

export type SuggestionKind = 'alt' | 'seo-description' | 'seo-title';

export interface SuggestionRequest {
  kind: SuggestionKind;
  /** For `alt`: the image URL. Ignored otherwise. */
  imageUrl?: string;
  /** Surrounding content the suggestion should be about. */
  context?: {
    title?: string;
    body?: string;
    siteName?: string;
  };
}

/**
 * Length ceilings, enforced in the prompt AND trimmed after the fact.
 *
 * The model is asked for a length and usually honours it, but "usually" is
 * not a contract — and an over-long search description is exactly the
 * warning `publish-checks.ts` raises (`seo-description-too-long`). A
 * suggestion that trips the product's own quality check would be worse than
 * no suggestion, so the ceiling is applied twice.
 */
export const MAX_ALT_CHARS = 125;
export const MAX_SEO_DESCRIPTION_CHARS = 155;
export const MAX_SEO_TITLE_CHARS = 60;

export function maxCharsFor(kind: SuggestionKind): number {
  if (kind === 'alt') return MAX_ALT_CHARS;
  if (kind === 'seo-title') return MAX_SEO_TITLE_CHARS;
  return MAX_SEO_DESCRIPTION_CHARS;
}

/** True when the deployment has an API key configured. */
export function isSuggestionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/**
 * Strips markup and collapses whitespace before the body reaches the model.
 *
 * Rich text is stored as HTML, and sending raw tags spends input tokens on
 * `<p>` and teaches the model that markup belongs in its answer — several of
 * the worst suggestions in testing were alt text containing `&nbsp;`.
 */
export function plainText(html: string | null | undefined, limit = 1500): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * The house rules every suggestion is written under.
 *
 * Deliberately short. The product's own voice guidance ("name the
 * consequence, not the rule"; no developer vocabulary) is stated once,
 * rather than repeated per-kind, because a system prompt that argues with
 * itself produces hedged output.
 */
export const SYSTEM_PROMPT = [
  'You write short, factual metadata for small organisation websites — mosques, logistics firms, property agents.',
  'Write plainly, in the register of the page itself. No marketing language, no superlatives, no calls to action.',
  'Never invent a fact that is not in the material you were given. If the material is too thin to describe, say so rather than guessing.',
  'Write in the same language as the content you are given.',
].join(' ');

export function buildPrompt(request: SuggestionRequest): string {
  const { kind, context } = request;
  const site = context?.siteName ? ` for ${context.siteName}` : '';
  const title = context?.title?.trim();
  const body = plainText(context?.body);

  if (kind === 'alt') {
    return [
      `Write alt text for this image${site}.`,
      'Describe what is actually visible, for someone who cannot see it — the subject and what it is doing, not the mood.',
      'Do not begin with "Image of" or "Picture of"; a screen reader already says that.',
      `At most ${MAX_ALT_CHARS} characters, one sentence, no trailing full stop.`,
      title ? `\nIt appears on a page titled "${title}".` : '',
      body ? `\nSurrounding text, for context only — describe the image, not this text:\n${body}` : '',
    ].filter(Boolean).join('\n');
  }

  if (kind === 'seo-title') {
    return [
      `Write the headline Google should show for this page${site}.`,
      `At most ${MAX_SEO_TITLE_CHARS} characters. Lead with what the page is about.`,
      'No site name, no separators like "|" — those are added separately.',
      title ? `\nThe page is called "${title}".` : '',
      body ? `\nThe page says:\n${body}` : '',
    ].filter(Boolean).join('\n');
  }

  return [
    `Write the summary Google should show under the headline for this page${site}.`,
    `One or two sentences, at most ${MAX_SEO_DESCRIPTION_CHARS} characters.`,
    'Say what a visitor will find on the page. Do not repeat the headline word for word.',
    title ? `\nThe page is called "${title}".` : '',
    body ? `\nThe page says:\n${body}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * The response schema.
 *
 * `suggestion` plus a `usable` flag, so "there was not enough to describe"
 * is a first-class answer rather than a hallucinated sentence. Structured
 * outputs make the shape a guarantee instead of a parsing exercise — this
 * is the replacement for the assistant-prefill trick, which no current
 * model accepts.
 */
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestion: {
      type: 'string',
      description: 'The suggested text, or an empty string when there was not enough to work from.',
    },
    usable: {
      type: 'boolean',
      description: 'False when the material was too thin to describe honestly.',
    },
  },
  required: ['suggestion', 'usable'],
  additionalProperties: false,
} as const;

export interface SuggestionResult {
  suggestion: string;
  usable: boolean;
}

/**
 * Applies the length ceiling after the fact, trimming at a word boundary so
 * a truncated suggestion still reads as a sentence rather than stopping
 * mid-word.
 */
export function clampSuggestion(raw: SuggestionResult, kind: SuggestionKind): SuggestionResult {
  const limit = maxCharsFor(kind);
  const text = raw.suggestion.trim().replace(/\s+/g, ' ');

  if (!raw.usable || text === '') return { suggestion: '', usable: false };
  if (text.length <= limit) return { suggestion: text, usable: true };

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return { suggestion: (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim(), usable: true };
}

/**
 * Which reserved SEO keys a collection's schema declares, so the entry
 * editor only offers a suggestion for a field that exists. Mirrors the
 * opt-in rule `src/lib/seo/entries.ts` established: a collection that never
 * asked for search fields is not nagged about them.
 */
export function suggestibleKeys(fields: FieldDef[], reserved: readonly string[]): string[] {
  return fields.filter((f) => reserved.includes(f.key) && !f.deprecated).map((f) => f.key);
}
