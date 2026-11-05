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
      body: { json: { type: 'doc', content: [] }, html: '<p>Hi</p>' },
      price: 10,
      in_stock: true,
      release_date: '2026-01-01',
      category: 'a',
      tags: ['x', 'y'],
      cover: { url: 'https://example.com/cover.jpg', alt: null },
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

  describe('presence-only types (text, textarea, date, gallery)', () => {
    it('passes for string values', () => {
      const fields: FieldDef[] = [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'textarea' },
        { key: 'release_date', label: 'Release date', type: 'date' },
      ];
      const data = {
        title: 'a',
        body: 'b',
        release_date: '2026-01-01',
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

  describe('richtext type', () => {
    const fields: FieldDef[] = [{ key: 'body', label: 'Body', type: 'richtext' }];

    it('passes for a valid { json, html } value', () => {
      const result = validateEntry(fields, {
        body: { json: { type: 'doc', content: [] }, html: '<p>Hi</p>' },
      });
      expect(result).toEqual({ ok: true });
    });

    it('fails for a plain string (the old, no-longer-supported shape)', () => {
      const result = validateEntry(fields, { body: '<p>Hi</p>' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.body).toBeDefined();
    });

    it('fails for an object missing html', () => {
      const result = validateEntry(fields, { body: { json: { type: 'doc' } } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.body).toBeDefined();
    });

    it('fails for an object missing json', () => {
      const result = validateEntry(fields, { body: { html: '<p>Hi</p>' } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.body).toBeDefined();
    });
  });

  describe('image type', () => {
    const fields: FieldDef[] = [{ key: 'cover', label: 'Cover', type: 'image' }];

    it('passes for a valid { url, alt } value with a string alt', () => {
      expect(validateEntry(fields, { cover: { url: 'https://example.com/x.jpg', alt: 'A cover' } }))
        .toEqual({ ok: true });
    });

    it('passes for a valid { url, alt } value with a null alt', () => {
      expect(validateEntry(fields, { cover: { url: 'https://example.com/x.jpg', alt: null } }))
        .toEqual({ ok: true });
    });

    it('fails for a plain string (the old, no-longer-supported shape)', () => {
      const result = validateEntry(fields, { cover: 'https://example.com/x.jpg' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.cover).toBeDefined();
    });

    it('fails when url is missing', () => {
      const result = validateEntry(fields, { cover: { alt: null } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.cover).toBeDefined();
    });

    it('fails when url is not a string', () => {
      const result = validateEntry(fields, { cover: { url: 123, alt: null } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.cover).toBeDefined();
    });
  });

  describe('taglist type', () => {
    const fields: FieldDef[] = [{ key: 'amenities', label: 'Amenities', type: 'taglist' }];

    it('passes for an array of non-blank strings', () => {
      expect(validateEntry(fields, { amenities: ['Pool', 'Gym'] })).toEqual({ ok: true });
    });

    it('fails for a bare string', () => {
      const result = validateEntry(fields, { amenities: 'Pool' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.amenities).toBeDefined();
    });

    it('fails when an entry is blank or not a string', () => {
      for (const bad of [['Pool', '  '], ['Pool', 42]]) {
        const result = validateEntry(fields, { amenities: bad });
        expect(result.ok).toBe(false);
      }
    });

    it('treats an empty array as missing for a required field', () => {
      const required: FieldDef[] = [{ ...fields[0], required: true }];
      const result = validateEntry(required, { amenities: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.amenities).toContain('required');
    });
  });

  describe('repeater type', () => {
    const fields: FieldDef[] = [
      {
        key: 'highlights',
        label: 'Highlights',
        type: 'repeater',
        fields: [
          { key: 'label', label: 'Label', type: 'text', required: true },
          { key: 'score', label: 'Score', type: 'number' },
        ],
      },
    ];

    it('passes for rows that satisfy the sub-schema', () => {
      expect(validateEntry(fields, { highlights: [{ label: 'Near MRT', score: 5 }, { label: 'Quiet' }] }))
        .toEqual({ ok: true });
    });

    it('fails for a non-array value', () => {
      const result = validateEntry(fields, { highlights: { label: 'Near MRT' } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.highlights).toBeDefined();
    });

    it('keys a sub-field error by its row path so the editor can point at it', () => {
      const result = validateEntry(fields, { highlights: [{ label: 'ok' }, { score: 3 }] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors['highlights[1].label']).toBeDefined();
        expect(result.errors['highlights[0].label']).toBeUndefined();
      }
    });

    it('reports a row that is not an object', () => {
      const result = validateEntry(fields, { highlights: ['just a string'] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors['highlights[0]']).toBeDefined();
    });

    it('validates a sub-field type, not just presence', () => {
      const result = validateEntry(fields, { highlights: [{ label: 'ok', score: 'five' }] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors['highlights[0].score']).toBeDefined();
    });

    it('ignores rows when the schema defines no sub-fields', () => {
      const noSub: FieldDef[] = [{ key: 'rows', label: 'Rows', type: 'repeater' }];
      expect(validateEntry(noSub, { rows: [{ anything: 1 }] })).toEqual({ ok: true });
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

describe('validateFieldDefs — repeater and format', () => {
  const sub: FieldDef[] = [{ key: 'label', label: 'Label', type: 'text' }];

  it('accepts a repeater with a valid sub-schema', () => {
    expect(validateFieldDefs([{ key: 'rows', label: 'Rows', type: 'repeater', fields: sub }]))
      .toEqual({ ok: true });
  });

  it('rejects a repeater with no sub-fields', () => {
    for (const fields of [undefined, []]) {
      const result = validateFieldDefs([{ key: 'rows', label: 'Rows', type: 'repeater', fields }]);
      expect(result.ok).toBe(false);
    }
  });

  it('validates sub-field keys recursively and names the path', () => {
    const result = validateFieldDefs([
      { key: 'rows', label: 'Rows', type: 'repeater', fields: [{ key: 'Bad Key', label: 'X', type: 'text' }] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('rows'))).toBe(true);
  });

  it('lets a sub-field reuse a top-level key (different objects)', () => {
    expect(validateFieldDefs([
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'rows', label: 'Rows', type: 'repeater', fields: [{ key: 'label', label: 'Label', type: 'text' }] },
    ])).toEqual({ ok: true });
  });

  it('still catches duplicate keys within one sub-schema', () => {
    const result = validateFieldDefs([
      {
        key: 'rows',
        label: 'Rows',
        type: 'repeater',
        fields: [
          { key: 'label', label: 'A', type: 'text' },
          { key: 'label', label: 'B', type: 'text' },
        ],
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('allows two levels of repeater nesting but rejects a third', () => {
    const twoDeep: FieldDef[] = [
      { key: 'sections', label: 'Sections', type: 'repeater', fields: [
        { key: 'cards', label: 'Cards', type: 'repeater', fields: sub },
      ] },
    ];
    expect(validateFieldDefs(twoDeep)).toEqual({ ok: true });

    const threeDeep: FieldDef[] = [
      { key: 'sections', label: 'Sections', type: 'repeater', fields: [
        { key: 'cards', label: 'Cards', type: 'repeater', fields: [
          { key: 'bullets', label: 'Bullets', type: 'repeater', fields: sub },
        ] },
      ] },
    ];
    const result = validateFieldDefs(threeDeep);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('levels deep'))).toBe(true);
  });

  it('rejects an out-of-range decimal places setting', () => {
    for (const precision of [-1, 7, 1.5]) {
      const result = validateFieldDefs([{ key: 'price', label: 'Price', type: 'number', format: { precision } }]);
      expect(result.ok).toBe(false);
    }
    expect(validateFieldDefs([{ key: 'price', label: 'Price', type: 'number', format: { precision: 2, prefix: 'S$' } }]))
      .toEqual({ ok: true });
  });
});
