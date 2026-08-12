import { describe, expect, it } from 'vitest';
import type { FieldDef } from '@/lib/collections/types';
import { isMissingSeo } from './audit';
import {
  SEO_DESCRIPTION_KEY,
  SEO_TITLE_KEY,
  auditableEntries,
  collectionHasSeoFields,
  entrySeoRow,
} from './entries';

const seoFields: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: SEO_TITLE_KEY, label: 'Search title', type: 'text' },
  { key: SEO_DESCRIPTION_KEY, label: 'Search description', type: 'textarea' },
];

const plainFields: FieldDef[] = [{ key: 'name', label: 'Name', type: 'text' }];

describe('collectionHasSeoFields', () => {
  it('is true when either reserved field is declared', () => {
    expect(collectionHasSeoFields(seoFields)).toBe(true);
    expect(collectionHasSeoFields([{ key: SEO_TITLE_KEY, label: 'T', type: 'text' }])).toBe(true);
    expect(collectionHasSeoFields([{ key: SEO_DESCRIPTION_KEY, label: 'D', type: 'text' }])).toBe(true);
  });

  it('is false for a collection that never opted in', () => {
    expect(collectionHasSeoFields(plainFields)).toBe(false);
    expect(collectionHasSeoFields([])).toBe(false);
    expect(collectionHasSeoFields(null)).toBe(false);
    expect(collectionHasSeoFields(undefined)).toBe(false);
  });
});

describe('entrySeoRow', () => {
  it('reads the reserved keys out of data', () => {
    const row = entrySeoRow({ id: 'e1', data: { seo_title: 'A title', seo_description: 'A description' } });
    expect(row).toEqual({ id: 'e1', seo_title: 'A title', seo_description: 'A description' });
    expect(isMissingSeo(row)).toBe(false);
  });

  it('treats blank, missing and non-string values as absent', () => {
    for (const data of [{}, { seo_title: '   ' }, { seo_title: 42 }, null]) {
      const row = entrySeoRow({ id: 'e1', data: data as Record<string, unknown> | null });
      expect(row.seo_title).toBeNull();
      expect(isMissingSeo(row)).toBe(true);
    }
  });

  it('flags a half-filled entry through the shared rule', () => {
    const row = entrySeoRow({ id: 'e1', data: { seo_title: 'Only a title' } });
    expect(isMissingSeo(row)).toBe(true);
    expect(row.seo_title).toBe('Only a title');
    expect(row.seo_description).toBeNull();
  });
});

describe('auditableEntries', () => {
  const collections = [
    { id: 'c-seo', fields: seoFields },
    { id: 'c-plain', fields: plainFields },
  ];
  const entries = [
    { id: 'e1', collection_id: 'c-seo', data: {} },
    { id: 'e2', collection_id: 'c-plain', data: {} },
    { id: 'e3', collection_id: 'c-seo', data: { seo_title: 'x', seo_description: 'y' } },
    { id: 'e4', collection_id: 'c-gone', data: {} },
  ];

  it('includes only entries of collections that opted in', () => {
    const out = auditableEntries(collections, entries);
    expect(out.map((r) => r.entry.id)).toEqual(['e1', 'e3']);
  });

  it('pairs each entry with its collection so a caller can label and link it', () => {
    const out = auditableEntries(collections, entries);
    expect(out[0].collection.id).toBe('c-seo');
  });

  it('drops entries whose collection is not in the set at all', () => {
    // `e4` points at a collection that was not loaded — silently ignored
    // rather than crashing an audit over a stale reference.
    expect(auditableEntries(collections, entries).some((r) => r.entry.id === 'e4')).toBe(false);
  });

  it('returns nothing when no collection opted in', () => {
    expect(auditableEntries([{ id: 'c-plain', fields: plainFields }], entries)).toEqual([]);
  });
});
