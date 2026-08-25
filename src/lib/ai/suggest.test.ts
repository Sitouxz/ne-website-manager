import { describe, expect, it } from 'vitest';
import {
  MAX_ALT_CHARS,
  MAX_SEO_DESCRIPTION_CHARS,
  buildPrompt,
  clampSuggestion,
  isSuggestionEnabled,
  maxCharsFor,
  plainText,
  suggestibleKeys,
} from './suggest';
import type { FieldDef } from '@/lib/collections/types';

describe('isSuggestionEnabled', () => {
  it('is off unless a key is configured', () => {
    // The whole feature has to vanish rather than render a broken button —
    // the exact anti-pattern the audit called out.
    expect(isSuggestionEnabled({})).toBe(false);
    expect(isSuggestionEnabled({ ANTHROPIC_API_KEY: '' })).toBe(false);
    expect(isSuggestionEnabled({ ANTHROPIC_API_KEY: '   ' })).toBe(false);
    expect(isSuggestionEnabled({ ANTHROPIC_API_KEY: 'sk-ant-real' })).toBe(true);
  });
});

describe('plainText', () => {
  it('strips markup and entities before the body reaches the model', () => {
    expect(plainText('<p>Prayers are <strong>daily</strong></p>')).toBe('Prayers are daily');
    expect(plainText('Tools&nbsp;&amp;&nbsp;guides')).toBe('Tools & guides');
  });

  it('collapses whitespace and truncates long bodies', () => {
    expect(plainText('<p>a</p>\n\n   <p>b</p>')).toBe('a b');
    expect(plainText('x'.repeat(5000)).length).toBe(1500);
  });

  it('handles missing content', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
  });
});

describe('buildPrompt', () => {
  it('asks for a description of the picture, not the page', () => {
    const prompt = buildPrompt({
      kind: 'alt',
      context: { title: 'Ramadan Timings', body: '<p>Prayers begin at dawn.</p>', siteName: 'Al-Islah' },
    });
    expect(prompt).toContain('for Al-Islah');
    expect(prompt).toContain('describe the image, not this text');
    // Screen readers already announce that it is an image.
    expect(prompt).toContain('Do not begin with "Image of"');
    expect(prompt).toContain(String(MAX_ALT_CHARS));
  });

  it('asks a search description to say what the visitor will find', () => {
    const prompt = buildPrompt({ kind: 'seo-description', context: { title: 'Donate' } });
    expect(prompt).toContain('under the headline');
    expect(prompt).toContain('Do not repeat the headline');
    expect(prompt).toContain(String(MAX_SEO_DESCRIPTION_CHARS));
  });

  it('keeps the site name out of a search title', () => {
    // It is appended separately by the site, so including it duplicates.
    expect(buildPrompt({ kind: 'seo-title', context: { title: 'Donate' } })).toContain('No site name');
  });

  it('omits context lines it was not given rather than sending empty labels', () => {
    const prompt = buildPrompt({ kind: 'seo-description' });
    expect(prompt).not.toContain('The page is called');
    expect(prompt).not.toContain('The page says');
  });
});

describe('clampSuggestion', () => {
  it('keeps a suggestion within its ceiling', () => {
    const long = 'word '.repeat(60).trim();
    const result = clampSuggestion({ suggestion: long, usable: true }, 'alt');
    expect(result.suggestion.length).toBeLessThanOrEqual(MAX_ALT_CHARS);
  });

  it('trims at a word boundary so it still reads as a sentence', () => {
    const result = clampSuggestion({ suggestion: 'word '.repeat(60).trim(), usable: true }, 'alt');
    expect(result.suggestion.endsWith('word')).toBe(true);
  });

  it('never emits a suggestion the product would then warn about', () => {
    // An over-long description trips `seo-description-too-long` in
    // publish-checks — handing someone a suggestion that fails the app's own
    // check would be worse than handing them nothing.
    const long = 'a very long sentence about the page. '.repeat(20);
    const result = clampSuggestion({ suggestion: long, usable: true }, 'seo-description');
    expect(result.suggestion.length).toBeLessThanOrEqual(MAX_SEO_DESCRIPTION_CHARS);
  });

  it('passes an already-short suggestion through, normalising whitespace', () => {
    expect(clampSuggestion({ suggestion: '  Men   praying  ', usable: true }, 'alt'))
      .toEqual({ suggestion: 'Men praying', usable: true });
  });

  it('treats "not enough to describe" as a real answer, not an empty string', () => {
    expect(clampSuggestion({ suggestion: 'something', usable: false }, 'alt'))
      .toEqual({ suggestion: '', usable: false });
    expect(clampSuggestion({ suggestion: '   ', usable: true }, 'alt'))
      .toEqual({ suggestion: '', usable: false });
  });
});

describe('maxCharsFor', () => {
  it('gives each kind its own ceiling', () => {
    expect(maxCharsFor('alt')).toBe(125);
    expect(maxCharsFor('seo-title')).toBe(60);
    expect(maxCharsFor('seo-description')).toBe(155);
  });
});

describe('suggestibleKeys', () => {
  const reserved = ['seo_title', 'seo_description'];

  it('only offers a suggestion for a field the collection actually declared', () => {
    const fields: FieldDef[] = [
      { key: 'seo_description', label: 'Search description', type: 'textarea' },
      { key: 'name', label: 'Name', type: 'text' },
    ];
    expect(suggestibleKeys(fields, reserved)).toEqual(['seo_description']);
  });

  it('skips a hidden field, which the editor no longer renders', () => {
    const fields: FieldDef[] = [
      { key: 'seo_title', label: 'Search title', type: 'text', deprecated: true },
      { key: 'seo_description', label: 'Search description', type: 'textarea' },
    ];
    expect(suggestibleKeys(fields, reserved)).toEqual(['seo_description']);
  });

  it('offers nothing for a collection that never opted in', () => {
    expect(suggestibleKeys([{ key: 'name', label: 'Name', type: 'text' }], reserved)).toEqual([]);
  });
});
