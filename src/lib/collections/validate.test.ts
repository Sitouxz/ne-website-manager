import { describe, expect, it } from 'vitest';
import type { FieldDef } from './types';
import { validateEntry, validateFieldDefs } from './validate';

describe('validateFieldDefs', () => {
  it('accepts a valid set of field defs', () => {
    const fields: FieldDef[] = [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'body', label: 'Body', type: 'richtext' },
      { key: 'category', label: 'Category', type: 'select', options: ['a', 'b'] },
    ];
    expect(validateFieldDefs(fields)).toEqual({ ok: true });
  });

  it('rejects an empty key', () => {
    const fields: FieldDef[] = [{ key: '', label: 'Title', type: 'text' }];
    const result = validateFieldDefs(fields);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a key that does not match snake_case', () => {
    const badKeys = ['Title', 'my-key', '1key', 'my key', 'MYKEY', 'key!'];
    for (const key of badKeys) {
      const result = validateFieldDefs([{ key, label: 'X', type: 'text' }]);
      expect(result.ok).toBe(false);
    }
  });

  it('accepts valid snake_case keys', () => {
    const goodKeys = ['title', 'my_key', 'key1', 'a', 'a_b_c_9'];
    for (const key of goodKeys) {
      const result = validateFieldDefs([{ key, label: 'X', type: 'text' }]);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects duplicate keys across the array', () => {
    const fields: FieldDef[] = [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'title', label: 'Title Again', type: 'text' },
    ];
    const result = validateFieldDefs(fields);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('title'))).toBe(true);
    }
  });

  it('requires a non-empty options array for select fields', () => {
    const result = validateFieldDefs([{ key: 'category', label: 'Category', type: 'select' }]);
    expect(result.ok).toBe(false);
  });

  it('requires a non-empty options array for multiselect fields', () => {
    const result = validateFieldDefs([
      { key: 'tags', label: 'Tags', type: 'multiselect', options: [] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('accepts select/multiselect fields with a non-empty options array', () => {
    const result = validateFieldDefs([
      { key: 'category', label: 'Category', type: 'select', options: ['a'] },
      { key: 'tags', label: 'Tags', type: 'multiselect', options: ['a', 'b'] },
    ]);
    expect(result.ok).toBe(true);
  });

  it('does not require options for non-select/multiselect types', () => {
    const result = validateFieldDefs([{ key: 'title', label: 'Title', type: 'text' }]);
    expect(result.ok).toBe(true);
  });

  it('accumulates multiple errors across multiple bad fields', () => {
    const fields: FieldDef[] = [
      { key: '', label: 'Bad', type: 'text' },
      { key: 'category', label: 'Category', type: 'select' },
    ];
    const result = validateFieldDefs(fields);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateEntry', () => {
  it('passes cleanly for a valid multi-field collection', () => {
    const fields: FieldDef[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'richtext' },
      { key: 'price', label: 'Price', type: 'number' },
      { key: 'in_stock', label: 'In stock', type: 'boolean' },
      { key: 'release_date', label: 'Release date', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', options: ['a', 'b'] },
      { key: 'tags', label: 'Tags', type: 'multiselect', options: ['x', 'y', 'z'] },
      { key: 'cover', label: 'Cover', type: 'image' },
      { key: 'photos', label: 'Photos', type: 'gallery' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'contact', label: 'Contact', type: 'email' },
      { key: 'meta', label: 'Meta', type: 'json' },
    ];
    const data = {
      title: 'Hello',
      body: '<p>Hi</p>',
      price: 10,
      in_stock: true,
      release_date: '2026-01-01',
      category: 'a',
      tags: ['x', 'y'],
      cover: 'https://example.com/cover.jpg',
      photos: ['https://example.com/1.jpg'],
      website: 'https://example.com',
      contact: 'test@example.com',
      meta: { foo: 'bar' },
    };
    expect(validateEntry(fields, data)).toEqual({ ok: true });
  });

  it('errors when a required field is missing (undefined)', () => {
    const fields: FieldDef[] = [{ key: 'title', label: 'Title', type: 'text', required: true }];
    const result = validateEntry(fields, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBeDefined();
  });

  it('errors when a required field is null', () => {
    const fields: FieldDef[] = [{ key: 'title', label: 'Title', type: 'text', required: true }];
    const result = validateEntry(fields, { title: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBeDefined();
  });

  it('errors when a required field is an empty string', () => {
    const fields: FieldDef[] = [{ key: 'title', label: 'Title', type: 'text', required: true }];
    const result = validateEntry(fields, { title: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBeDefined();
  });

  it('is fine when a non-required field is absent from data', () => {
    const fields: FieldDef[] = [{ key: 'subtitle', label: 'Subtitle', type: 'text' }];
    expect(validateEntry(fields, {})).toEqual({ ok: true });
  });

  it('ignores data keys with no matching field def', () => {
    const fields: FieldDef[] = [{ key: 'title', label: 'Title', type: 'text' }];
    expect(validateEntry(fields, { title: 'Hi', extra: 'ignored' })).toEqual({ ok: true });
  });

  describe('number type', () => {
    const fields: FieldDef[] = [{ key: 'price', label: 'Price', type: 'number' }];
    it('passes for a number', () => {
      expect(validateEntry(fields, { price: 10 })).toEqual({ ok: true });
    });
    it('fails for a non-number', () => {
      const result = validateEntry(fields, { price: 'ten' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.price).toBeDefined();
    });
  });

  describe('boolean type', () => {
    const fields: FieldDef[] = [{ key: 'in_stock', label: 'In stock', type: 'boolean' }];
    it('passes for a boolean', () => {
      expect(validateEntry(fields, { in_stock: false })).toEqual({ ok: true });
    });
    it('fails for a non-boolean', () => {
      const result = validateEntry(fields, { in_stock: 'yes' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.in_stock).toBeDefined();
    });
  });

  describe('select type', () => {
    const fields: FieldDef[] = [
      { key: 'category', label: 'Category', type: 'select', options: ['a', 'b'] },
    ];
    it('passes for a value in options', () => {
      expect(validateEntry(fields, { category: 'a' })).toEqual({ ok: true });
    });
    it('fails for a value not in options', () => {
      const result = validateEntry(fields, { category: 'z' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.category).toBeDefined();
    });
  });

  describe('multiselect type', () => {
    const fields: FieldDef[] = [
      { key: 'tags', label: 'Tags', type: 'multiselect', options: ['x', 'y', 'z'] },
    ];
    it('passes when every element is a valid option', () => {
      expect(validateEntry(fields, { tags: ['x', 'z'] })).toEqual({ ok: true });
    });
    it('fails when the value is not an array', () => {
      const result = validateEntry(fields, { tags: 'x' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.tags).toBeDefined();
    });
    it('fails when an element is not a valid option', () => {
      const result = validateEntry(fields, { tags: ['x', 'nope'] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.tags).toBeDefined();
    });
  });

  describe('email type', () => {
    const fields: FieldDef[] = [{ key: 'contact', label: 'Contact', type: 'email' }];
    it('passes for a well-formed email', () => {
      expect(validateEntry(fields, { contact: 'test@example.com' })).toEqual({ ok: true });
    });
    it('fails for a malformed email', () => {
      const result = validateEntry(fields, { contact: 'not-an-email' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.contact).toBeDefined();
    });
  });

  describe('url type', () => {
    const fields: FieldDef[] = [{ key: 'website', label: 'Website', type: 'url' }];
    it('passes for a well-formed URL', () => {
      expect(validateEntry(fields, { website: 'https://example.com' })).toEqual({ ok: true });
    });
    it('fails for a malformed URL', () => {
      const result = validateEntry(fields, { website: 'not a url' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.website).toBeDefined();
    });
  });

  describe('json type', () => {
    const fields: FieldDef[] = [{ key: 'meta', label: 'Meta', type: 'json' }];
    it('passes for an object', () => {
      expect(validateEntry(fields, { meta: { a: 1 } })).toEqual({ ok: true });
    });
    it('passes for an array', () => {
      expect(validateEntry(fields, { meta: [1, 2, 3] })).toEqual({ ok: true });
    });
    it('fails for a primitive', () => {
      const result = validateEntry(fields, { meta: 'not json' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.meta).toBeDefined();
    });
  });

  describe('presence-only types (text, textarea, richtext, date, image, gallery)', () => {
    it('passes for string values', () => {
      const fields: FieldDef[] = [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'textarea' },
        { key: 'content', label: 'Content', type: 'richtext' },
        { key: 'release_date', label: 'Release date', type: 'date' },
        { key: 'cover', label: 'Cover', type: 'image' },
      ];
      const data = {
        title: 'a',
        body: 'b',
        content: 'c',
        release_date: '2026-01-01',
        cover: 'https://example.com/x.jpg',
      };
      expect(validateEntry(fields, data)).toEqual({ ok: true });
    });

    it('passes for a gallery array of strings', () => {
      const fields: FieldDef[] = [{ key: 'photos', label: 'Photos', type: 'gallery' }];
      expect(validateEntry(fields, { photos: ['a.jpg', 'b.jpg'] })).toEqual({ ok: true });
    });

    it('fails when a gallery value is not an array', () => {
      const fields: FieldDef[] = [{ key: 'photos', label: 'Photos', type: 'gallery' }];
      const result = validateEntry(fields, { photos: 'a.jpg' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.photos).toBeDefined();
    });

    it('fails when a text-like value is not a string', () => {
      const fields: FieldDef[] = [{ key: 'title', label: 'Title', type: 'text' }];
      const result = validateEntry(fields, { title: 123 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.title).toBeDefined();
    });
  });

  it('reports multiple field errors keyed by their field key', () => {
    const fields: FieldDef[] = [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'price', label: 'Price', type: 'number' },
    ];
    const result = validateEntry(fields, { price: 'ten' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBeDefined();
      expect(result.errors.price).toBeDefined();
    }
  });
});
