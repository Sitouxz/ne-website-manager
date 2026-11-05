import { describe, expect, it } from 'vitest';
import type { FieldDef } from './types';
import { validateEntry } from './validate';
import {
  checkRename,
  copyKeyInData,
  countFieldUsage,
  describeFieldRemoval,
  dropKeyInData,
  hasContent,
  renameFieldInSchema,
  renameKeyInOptions,
  setFieldDeprecated,
  visibleFields,
  type UsageEntry,
} from './schema-changes';

const entry = (data: Record<string, unknown> | null, status = 'draft'): UsageEntry => ({ data, status });

describe('hasContent', () => {
  it('treats 0 and false as content', () => {
    // A price of 0 and "featured: false" are deliberate answers. Counting
    // them as empty would under-report a removal and cost someone data.
    expect(hasContent(0)).toBe(true);
    expect(hasContent(false)).toBe(true);
  });

  it('treats null, undefined and blank strings as empty', () => {
    expect(hasContent(null)).toBe(false);
    expect(hasContent(undefined)).toBe(false);
    expect(hasContent('')).toBe(false);
    expect(hasContent('   ')).toBe(false);
  });

  it('treats an emptied rich-text field as empty', () => {
    // Tiptap serialises a cleared editor as an empty paragraph, not "".
    expect(hasContent('<p></p>')).toBe(false);
    expect(hasContent('<p><br></p>')).toBe(false);
    expect(hasContent('<p>&nbsp;</p>')).toBe(false);
    expect(hasContent('<p>Real words</p>')).toBe(true);
  });

  it('treats empty collections as empty and filled ones as content', () => {
    expect(hasContent([])).toBe(false);
    expect(hasContent({})).toBe(false);
    expect(hasContent(['tag'])).toBe(true);
    expect(hasContent({ a: 1 })).toBe(true);
  });
});

describe('countFieldUsage', () => {
  const entries: UsageEntry[] = [
    entry({ price: 100, note: 'hi' }, 'published'),
    entry({ price: 0 }, 'published'),
    entry({ price: null, note: 'only a note' }, 'draft'),
    entry({}, 'draft'),
    entry(null, 'archived'),
  ];

  it('counts entries holding content, including zeroes', () => {
    expect(countFieldUsage(entries, 'price')).toEqual({
      total: 5,
      withContent: 2,
      publishedWithContent: 2,
    });
  });

  it('separates published usage from total usage', () => {
    expect(countFieldUsage(entries, 'note')).toEqual({
      total: 5,
      withContent: 2,
      publishedWithContent: 1,
    });
  });

  it('reports an unused field as safe to remove', () => {
    expect(countFieldUsage(entries, 'never_filled')).toEqual({
      total: 5,
      withContent: 0,
      publishedWithContent: 0,
    });
  });
});

describe('describeFieldRemoval', () => {
  it('says nothing when no entry holds content', () => {
    // Removing a typo from an empty collection should not require reading a
    // scary dialog.
    expect(describeFieldRemoval({ total: 4, withContent: 0, publishedWithContent: 0 }, 'Price')).toBeNull();
  });

  it('names the consequence when content is unpublished', () => {
    const msg = describeFieldRemoval({ total: 40, withContent: 23, publishedWithContent: 0 }, 'Price');
    expect(msg).toBe('23 entries of 40 have content in "Price". Removing the field leaves that content unreachable.');
  });

  it('warns about the live website when published entries are affected', () => {
    const msg = describeFieldRemoval({ total: 40, withContent: 23, publishedWithContent: 12 }, 'Price');
    expect(msg).toContain('23 entries of 40 have content in "Price".');
    expect(msg).toContain('12 of those are published');
    expect(msg).toContain('those pages are rebuilt');
  });

  it('reads correctly for a single entry', () => {
    const msg = describeFieldRemoval({ total: 1, withContent: 1, publishedWithContent: 1 }, 'Price');
    expect(msg).toBe(
      '1 entry of 1 has content in "Price". 1 of them is published, so that content disappears from the website the next time that page is rebuilt.',
    );
  });
});

describe('deprecation', () => {
  const fields: FieldDef[] = [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'legacy_price', label: 'Old price', type: 'number' },
  ];

  it('hides a deprecated field from humans but keeps it in the schema', () => {
    const next = setFieldDeprecated(fields, 'legacy_price', true);
    expect(next).toHaveLength(2);
    expect(visibleFields(next).map((f) => f.key)).toEqual(['title']);
  });

  it('can be undone', () => {
    const hidden = setFieldDeprecated(fields, 'legacy_price', true);
    const restored = setFieldDeprecated(hidden, 'legacy_price', false);
    expect(visibleFields(restored)).toHaveLength(2);
    expect(restored[1].deprecated).toBeUndefined();
  });

  it('never blocks saving an entry', () => {
    // The point of the whole feature: a deprecated field must not be able to
    // strand an entry behind a validation error its editor cannot fix.
    const required: FieldDef[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'legacy_price', label: 'Old price', type: 'number', required: true, deprecated: true },
    ];
    expect(validateEntry(required, { title: 'Still editable' })).toEqual({ ok: true });
  });

  it('does not reject legacy data of the wrong type on a deprecated field', () => {
    const required: FieldDef[] = [
      { key: 'legacy_price', label: 'Old price', type: 'number', deprecated: true },
    ];
    expect(validateEntry(required, { legacy_price: 'was a string all along' })).toEqual({ ok: true });
  });
});

describe('the three-phase rename migration', () => {
  it('phase 1 copies the value without disturbing the old key', () => {
    // The schema still names `old` at this point, so `old` must survive.
    const { data, changed } = copyKeyInData({ old: 'value', other: 1 }, 'old', 'fresh');
    expect(changed).toBe(true);
    expect(data).toEqual({ old: 'value', fresh: 'value', other: 1 });
  });

  it('phase 1 places the copy next to its original for a readable diff', () => {
    const { data } = copyKeyInData({ a: 1, old: 2, z: 3 }, 'old', 'fresh');
    expect(Object.keys(data)).toEqual(['a', 'old', 'fresh', 'z']);
  });

  it('phase 3 removes the old key once the schema has moved on', () => {
    const { data, changed } = dropKeyInData({ old: 'value', fresh: 'value', other: 1 }, 'old');
    expect(changed).toBe(true);
    expect(data).toEqual({ fresh: 'value', other: 1 });
  });

  it('never leaves the entry looking empty at any phase', () => {
    // The invariant the whole design exists to hold: whichever key the
    // schema currently names is populated, at every step.
    const start = { old: 'value' };
    const afterCopy = copyKeyInData(start, 'old', 'fresh').data;
    expect(hasContent(afterCopy.old)).toBe(true);   // schema still says `old`
    expect(hasContent(afterCopy.fresh)).toBe(true); // schema now says `fresh`
    const afterDrop = dropKeyInData(afterCopy, 'old').data;
    expect(hasContent(afterDrop.fresh)).toBe(true);
  });

  it('is idempotent when a partial migration is re-run', () => {
    const once = copyKeyInData({ old: 'value' }, 'old', 'fresh').data;
    const twice = copyKeyInData(once, 'old', 'fresh');
    expect(twice.changed).toBe(false);
    expect(twice.data).toEqual({ old: 'value', fresh: 'value' });
    expect(dropKeyInData(dropKeyInData(twice.data, 'old').data, 'old').data).toEqual({ fresh: 'value' });
  });

  it('never lets a stale copy clobber an already-migrated value', () => {
    // On a re-run, `fresh` is the live value and `old` is the stale leftover.
    const { data, changed } = copyKeyInData({ old: 'stale', fresh: 'live' }, 'old', 'fresh');
    expect(changed).toBe(false);
    expect(data.fresh).toBe('live');
  });

  it('is a no-op on rows that never had the key', () => {
    expect(copyKeyInData({ other: 1 }, 'old', 'fresh').changed).toBe(false);
    expect(dropKeyInData({ other: 1 }, 'old').changed).toBe(false);
  });

  it('handles a null data blob', () => {
    expect(copyKeyInData(null, 'old', 'fresh')).toEqual({ data: {}, changed: false });
    expect(dropKeyInData(null, 'old')).toEqual({ data: {}, changed: false });
  });
});

describe('renameFieldInSchema', () => {
  const fields: FieldDef[] = [
    { key: 'old', label: 'Old label', type: 'text', required: true },
    { key: 'other', label: 'Other', type: 'text' },
  ];

  it('renames the key and keeps every other property', () => {
    const next = renameFieldInSchema(fields, 'old', 'fresh');
    expect(next[0]).toEqual({ key: 'fresh', label: 'Old label', type: 'text', required: true });
    expect(next[1]).toEqual(fields[1]);
  });

  it('can relabel at the same time', () => {
    const next = renameFieldInSchema(fields, 'old', 'fresh', 'Fresh label');
    expect(next[0].label).toBe('Fresh label');
  });

  it('ignores a blank new label rather than erasing the old one', () => {
    const next = renameFieldInSchema(fields, 'old', 'fresh', '   ');
    expect(next[0].label).toBe('Old label');
  });
});

describe('renameKeyInOptions', () => {
  it('follows the rename through every display option that names a key', () => {
    // A rename that misses these renders the list view as blank cells rather
    // than as an error, which is worse than failing.
    const next = renameKeyInOptions(
      { title_field: 'old', list_columns: ['old', 'other'], list_filters: ['other', 'old'] },
      'old',
      'fresh',
    );
    expect(next).toEqual({
      title_field: 'fresh',
      list_columns: ['fresh', 'other'],
      list_filters: ['other', 'fresh'],
    });
  });

  it('leaves unrelated options alone', () => {
    const next = renameKeyInOptions({ title_field: 'other', list_columns: undefined }, 'old', 'fresh');
    expect(next.title_field).toBe('other');
    expect(next.list_columns).toBeUndefined();
  });
});

describe('checkRename', () => {
  const fields: FieldDef[] = [
    { key: 'price', label: 'Price', type: 'number' },
    { key: 'title', label: 'Title', type: 'text' },
  ];

  it('accepts a valid rename', () => {
    expect(checkRename(fields, 'price', 'asking_price')).toEqual({ ok: true });
  });

  it('rejects a key that would collide with an existing field', () => {
    const result = checkRename(fields, 'price', 'title');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('already used');
  });

  it('rejects a key that is not snake_case, before any row is touched', () => {
    const result = checkRename(fields, 'price', 'Asking Price');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('lowercase letters');
  });

  it('rejects renaming a field that does not exist', () => {
    expect(checkRename(fields, 'nope', 'fresh').ok).toBe(false);
  });

  it('rejects a no-op rename', () => {
    expect(checkRename(fields, 'price', 'price').ok).toBe(false);
  });
});
