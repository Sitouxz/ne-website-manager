import { describe, expect, it } from 'vitest';
import {
  POST_DIFF_FIELDS,
  diffSnapshot,
  diffWords,
  entryDiffFields,
  flattenEntry,
  formatValue,
  htmlToText,
} from './diff';

describe('htmlToText', () => {
  it('drops tags, turns blocks into line breaks and decodes entities', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p><p>Tom &amp; Jerry&nbsp;!</p>')).toBe('Hello world\nTom & Jerry !');
  });
});

describe('formatValue', () => {
  it('renders empties, booleans, lists and objects for display', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue('')).toBe('');
    expect(formatValue(true)).toBe('Yes');
    expect(formatValue(false)).toBe('No');
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue({ url: 'x' })).toBe('{"url":"x"}');
  });
});

describe('diffWords', () => {
  it('marks only the changed words and re-joins to both originals', () => {
    const before = 'Join us for Friday prayers at 1pm';
    const after = 'Join us for Friday prayers at 1.30pm in the main hall';
    const segments = diffWords(before, after)!;

    const rebuiltBefore = segments.filter((s) => s.type !== 'added').map((s) => s.text).join('');
    const rebuiltAfter = segments.filter((s) => s.type !== 'removed').map((s) => s.text).join('');
    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
    expect(segments.find((s) => s.type === 'removed')?.text).toContain('1pm');
    expect(segments.filter((s) => s.type === 'added').map((s) => s.text).join('')).toContain('main hall');
    expect(segments[0]).toEqual({ type: 'same', text: 'Join us for Friday prayers at ' });
  });

  it('returns a single same segment for identical text', () => {
    expect(diffWords('a b', 'a b')).toEqual([{ type: 'same', text: 'a b' }]);
  });

  it('diffs a small edit inside a long text, since the shared prefix and suffix are trimmed', () => {
    const words = Array.from({ length: 8000 }, (_, i) => `w${i}`);
    const edited = [...words];
    edited[4000] = 'changed';
    const segments = diffWords(words.join(' '), edited.join(' '));
    expect(segments).not.toBeNull();
    expect(segments!.filter((s) => s.type === 'added').map((s) => s.text.trim())).toEqual(['changed']);
  });

  it('gives up on inputs past the size budget', () => {
    const big = Array.from({ length: 6000 }, (_, i) => `w${i}`).join(' ');
    const other = Array.from({ length: 6000 }, (_, i) => `x${i}`).join(' ');
    expect(diffWords(big, other)).toBeNull();
  });
});

describe('diffSnapshot', () => {
  const revision = {
    title: 'Open house', slug: 'open-house', status: 'draft', excerpt: '', content: '<p>Doors open at 9.</p>',
    category: 'Events', tags: ['community', 'family'], cover_url: null, seo_title: null, seo_description: null,
    og_image_url: null, canonical_url: null, noindex: false,
  };

  it('returns only fields that changed, in schema order', () => {
    const current = { ...revision, title: 'Open house 2026', content: '<p>Doors open at 10.</p>', tags: ['community', 'youth'] };
    const changes = diffSnapshot(revision, current, POST_DIFF_FIELDS);

    expect(changes.map((c) => c.key)).toEqual(['title', 'content', 'tags']);
    const tags = changes.find((c) => c.key === 'tags')!;
    expect(tags.added).toEqual(['youth']);
    expect(tags.removed).toEqual(['family']);
    const body = changes.find((c) => c.key === 'content')!;
    expect(body.before).toBe('Doors open at 9.');
    expect(body.segments?.some((s) => s.type === 'added' && s.text.includes('10.'))).toBe(true);
  });

  it('treats null, undefined and empty string as the same empty value', () => {
    const current = { ...revision, excerpt: null, seo_title: '', canonical_url: undefined };
    expect(diffSnapshot(revision, current, POST_DIFF_FIELDS)).toEqual([]);
  });

  it('reports scalar changes as before/after without segments', () => {
    const current = { ...revision, noindex: true, status: 'in_review' };
    const changes = diffSnapshot(revision, current, POST_DIFF_FIELDS);
    expect(changes).toEqual([
      expect.objectContaining({ key: 'status', before: 'draft', after: 'in_review' }),
      expect.objectContaining({ key: 'noindex', before: 'No', after: 'Yes' }),
    ]);
    expect(changes[0].segments).toBeUndefined();
  });

  it('flags very long text as too large instead of diffing it', () => {
    const longA = Array.from({ length: 6000 }, (_, i) => `a${i}`).join(' ');
    const longB = Array.from({ length: 6000 }, (_, i) => `b${i}`).join(' ');
    const changes = diffSnapshot({ ...revision, excerpt: longA }, { ...revision, excerpt: longB }, POST_DIFF_FIELDS);
    expect(changes[0]).toMatchObject({ key: 'excerpt', tooLarge: true });
  });
});

describe('collection entries', () => {
  it('diffs data fields using the collection schema labels and kinds', () => {
    const fields = entryDiffFields([
      { key: 'speaker', label: 'Speaker', type: 'text' },
      { key: 'topics', label: 'Topics', type: 'multiselect' },
      { key: 'notes', label: 'Notes', type: 'richtext' },
    ]);
    const revision = flattenEntry({ slug: 's1', status: 'draft', data: { speaker: 'Imam A', topics: ['faith'], notes: '<p>One</p>' } });
    const current = flattenEntry({ slug: 's1', status: 'draft', data: { speaker: 'Imam B', topics: ['faith', 'family'], notes: '<p>One</p>' } });

    const changes = diffSnapshot(revision, current, fields);
    expect(changes.map((c) => c.label)).toEqual(['Speaker', 'Topics']);
    expect(changes[1].added).toEqual(['family']);
  });
});
