import { describe, expect, it } from 'vitest';
import type { FieldDef } from './types';
import type { CollectionOptions } from '@/lib/supabase/types';
import {
  canReorderEntries,
  deriveEntryTitle,
  distinctValues,
  filterAndSortEntries,
  formatFieldValue,
  hasActiveQuery,
  matchesFilter,
  resolveListColumns,
  resolveListFilters,
  type EntryLike,
  type EntryListQuery,
} from './display';

const def = (overrides: Partial<FieldDef>): FieldDef => ({
  key: 'k',
  label: 'L',
  type: 'text',
  ...overrides,
});

describe('formatFieldValue', () => {
  it('returns an empty string for values that are not set', () => {
    for (const value of [undefined, null, '']) {
      expect(formatFieldValue(def({}), value)).toBe('');
    }
  });

  it('applies number format', () => {
    const price = def({ type: 'number', format: { precision: 2, prefix: 'S$', suffix: 'psf' } });
    expect(formatFieldValue(price, 1234.5)).toBe('S$1234.50 psf');
    expect(formatFieldValue(def({ type: 'number' }), 7)).toBe('7');
  });

  it('renders booleans as Yes/No, including false', () => {
    // `false` is a set value, not a missing one — the early return checks
    // undefined/null/'' precisely so this case survives.
    expect(formatFieldValue(def({ type: 'boolean' }), false)).toBe('No');
    expect(formatFieldValue(def({ type: 'boolean' }), true)).toBe('Yes');
  });

  it('joins list values and counts media/rows', () => {
    expect(formatFieldValue(def({ type: 'taglist' }), ['Pool', 'Gym'])).toBe('Pool, Gym');
    expect(formatFieldValue(def({ type: 'multiselect' }), ['a'])).toBe('a');
    expect(formatFieldValue(def({ type: 'gallery' }), [{ url: 'a' }, { url: 'b' }])).toBe('2 images');
    expect(formatFieldValue(def({ type: 'gallery' }), [{ url: 'a' }])).toBe('1 image');
    expect(formatFieldValue(def({ type: 'repeater' }), [{}, {}, {}])).toBe('3 items');
    expect(formatFieldValue(def({ type: 'gallery' }), [])).toBe('');
  });

  it('prefers an image alt over the generic label', () => {
    expect(formatFieldValue(def({ type: 'image' }), { url: 'x.jpg', alt: 'Front door' })).toBe('Front door');
    expect(formatFieldValue(def({ type: 'image' }), { url: 'x.jpg', alt: null })).toBe('Image');
    expect(formatFieldValue(def({ type: 'image' }), { url: '', alt: null })).toBe('');
  });

  it('strips tags from rich text rather than rendering them', () => {
    const value = { json: {}, html: '<p>Hello <strong>there</strong></p>' };
    expect(formatFieldValue(def({ type: 'richtext' }), value)).toBe('Hello there');
  });

  it('truncates long values', () => {
    const long = 'a'.repeat(100);
    const out = formatFieldValue(def({}), long, 10);
    expect(out).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('distinctValues', () => {
  it('collects scalar values, sorted and deduplicated', () => {
    const field = def({ key: 'segment', type: 'select', options: ['Luxury', 'Mass', 'Unused'] });
    const rows = [{ segment: 'Mass' }, { segment: 'Luxury' }, { segment: 'Mass' }, {}];
    // 'Unused' is in the schema but in no entry, so it is not offered.
    expect(distinctValues(field, rows)).toEqual(['Luxury', 'Mass']);
  });

  it('flattens array members for taglist and multiselect', () => {
    const field = def({ key: 'amenities', type: 'taglist' });
    const rows = [{ amenities: ['Pool', 'Gym'] }, { amenities: ['Gym'] }];
    expect(distinctValues(field, rows)).toEqual(['Gym', 'Pool']);
  });

  it('renders booleans as their display labels', () => {
    const field = def({ key: 'available', type: 'boolean' });
    expect(distinctValues(field, [{ available: true }, { available: false }])).toEqual(['No', 'Yes']);
  });
});

describe('matchesFilter', () => {
  it('matches a scalar value exactly', () => {
    const field = def({ key: 'segment', type: 'select' });
    expect(matchesFilter(field, { segment: 'Mass' }, 'Mass')).toBe(true);
    expect(matchesFilter(field, { segment: 'Luxury' }, 'Mass')).toBe(false);
    expect(matchesFilter(field, {}, 'Mass')).toBe(false);
  });

  it('matches membership for list fields', () => {
    const field = def({ key: 'amenities', type: 'taglist' });
    expect(matchesFilter(field, { amenities: ['Pool', 'Gym'] }, 'Gym')).toBe(true);
    expect(matchesFilter(field, { amenities: ['Pool'] }, 'Gym')).toBe(false);
  });

  it('matches booleans through their display labels', () => {
    const field = def({ key: 'available', type: 'boolean' });
    expect(matchesFilter(field, { available: false }, 'No')).toBe(true);
    expect(matchesFilter(field, { available: true }, 'No')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entries list behaviour
// ---------------------------------------------------------------------------

const LIST_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'district', label: 'District', type: 'select', options: ['D9', 'D10'] },
  { key: 'price', label: 'Price', type: 'number', format: { precision: 0, prefix: 'S$' } },
  { key: 'amenities', label: 'Amenities', type: 'taglist' },
  { key: 'story', label: 'Story', type: 'textarea' },
];

function entry(overrides: Partial<EntryLike> & { data: Record<string, unknown> }): EntryLike {
  return {
    slug: 'an-entry',
    status: 'published',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const ROWS: EntryLike[] = [
  entry({ slug: 'alpha', status: 'published', created_at: '2026-01-03T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', data: { name: 'Alpha Court', district: 'D9', price: 900, amenities: ['Pool'] } }),
  entry({ slug: 'beta', status: 'draft', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z', data: { name: 'Beta House', district: 'D10', price: 700, amenities: ['Gym', 'Pool'] } }),
  entry({ slug: 'gamma', status: 'published', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-15T00:00:00Z', data: { name: 'Gamma Lodge', district: 'D9', price: 1200 } }),
];

const emptyQuery: EntryListQuery = { search: '', status: 'all', fieldFilters: {} };
const titled: CollectionOptions = { title_field: 'name' };

describe('deriveEntryTitle', () => {
  it('prefers the title field, falling back to the slug', () => {
    expect(deriveEntryTitle(ROWS[0], 'name')).toBe('Alpha Court');
    expect(deriveEntryTitle(ROWS[0], 'missing')).toBe('alpha');
    expect(deriveEntryTitle(ROWS[0], undefined)).toBe('alpha');
    expect(deriveEntryTitle(entry({ slug: '', data: {} }), 'name')).toBe('(untitled)');
  });

  it('ignores a title field holding a blank string', () => {
    expect(deriveEntryTitle(entry({ slug: 'fallback', data: { name: '   ' } }), 'name')).toBe('fallback');
  });
});

describe('resolveListColumns / resolveListFilters', () => {
  it('resolves keys against the live schema and drops deleted fields', () => {
    const columns = resolveListColumns(LIST_FIELDS, { list_columns: ['district', 'gone', 'price'] });
    expect(columns.map((f) => f.key)).toEqual(['district', 'price']);
  });

  it('caps columns at the maximum', () => {
    const columns = resolveListColumns(LIST_FIELDS, {
      list_columns: ['name', 'district', 'price', 'amenities', 'story'],
    });
    expect(columns).toHaveLength(3);
  });

  it('drops filters whose field type cannot be filtered on', () => {
    const filters = resolveListFilters(LIST_FIELDS, { list_filters: ['district', 'story', 'amenities'] });
    // `story` is a textarea — one option per entry is not a filter.
    expect(filters.map((f) => f.key)).toEqual(['district', 'amenities']);
  });

  it('returns nothing when a collection configures nothing', () => {
    expect(resolveListColumns(LIST_FIELDS, undefined)).toEqual([]);
    expect(resolveListFilters(LIST_FIELDS, {})).toEqual([]);
  });
});

describe('hasActiveQuery', () => {
  it('is false only for a completely empty query', () => {
    expect(hasActiveQuery(emptyQuery)).toBe(false);
    expect(hasActiveQuery({ ...emptyQuery, search: '  ' })).toBe(false);
    expect(hasActiveQuery({ ...emptyQuery, search: 'a' })).toBe(true);
    expect(hasActiveQuery({ ...emptyQuery, status: 'draft' })).toBe(true);
    expect(hasActiveQuery({ ...emptyQuery, fieldFilters: { district: '' } })).toBe(false);
    expect(hasActiveQuery({ ...emptyQuery, fieldFilters: { district: 'D9' } })).toBe(true);
  });
});

describe('canReorderEntries', () => {
  it('allows dragging only under manual order with no active filter', () => {
    expect(canReorderEntries(titled, emptyQuery)).toBe(true);
    expect(canReorderEntries({ ...titled, sort_default: 'manual' }, emptyQuery)).toBe(true);
    expect(canReorderEntries({ ...titled, sort_default: 'title' }, emptyQuery)).toBe(false);
    expect(canReorderEntries(titled, { ...emptyQuery, status: 'draft' })).toBe(false);
    expect(canReorderEntries(titled, { ...emptyQuery, search: 'alpha' })).toBe(false);
  });
});

describe('filterAndSortEntries', () => {
  it('returns the input order untouched under manual sorting', () => {
    const out = filterAndSortEntries(ROWS, LIST_FIELDS, titled, emptyQuery);
    expect(out.map((r) => r.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('applies each ordering preset', () => {
    const order = (sort: CollectionOptions['sort_default']) =>
      filterAndSortEntries(ROWS, LIST_FIELDS, { ...titled, sort_default: sort }, emptyQuery).map((r) => r.slug);

    expect(order('newest')).toEqual(['alpha', 'gamma', 'beta']);
    expect(order('oldest')).toEqual(['beta', 'gamma', 'alpha']);
    expect(order('recently_updated')).toEqual(['beta', 'alpha', 'gamma']);
    expect(order('title')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...ROWS];
    filterAndSortEntries(input, LIST_FIELDS, { ...titled, sort_default: 'title' }, emptyQuery);
    expect(input.map((r) => r.slug)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('filters by status', () => {
    const out = filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, status: 'draft' });
    expect(out.map((r) => r.slug)).toEqual(['beta']);
  });

  it('filters by a field value, and by list membership', () => {
    const byDistrict = filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, fieldFilters: { district: 'D9' } });
    expect(byDistrict.map((r) => r.slug)).toEqual(['alpha', 'gamma']);

    const byAmenity = filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, fieldFilters: { amenities: 'Pool' } });
    expect(byAmenity.map((r) => r.slug)).toEqual(['alpha', 'beta']);
  });

  it('combines filters as AND', () => {
    const out = filterAndSortEntries(ROWS, LIST_FIELDS, titled, {
      search: '',
      status: 'published',
      fieldFilters: { district: 'D9', amenities: 'Pool' },
    });
    expect(out.map((r) => r.slug)).toEqual(['alpha']);
  });

  it('ignores a filter naming a field that no longer exists', () => {
    const out = filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, fieldFilters: { gone: 'anything' } });
    expect(out).toHaveLength(3);
  });

  it('searches the title and the slug, case-insensitively', () => {
    expect(filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, search: 'beta h' }).map((r) => r.slug))
      .toEqual(['beta']);
    expect(filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, search: 'GAMMA' }).map((r) => r.slug))
      .toEqual(['gamma']);
  });

  it('searches configured columns but not fields the row does not display', () => {
    const withColumn: CollectionOptions = { ...titled, list_columns: ['district'] };
    expect(filterAndSortEntries(ROWS, LIST_FIELDS, withColumn, { ...emptyQuery, search: 'D10' }).map((r) => r.slug))
      .toEqual(['beta']);

    // Same term, but `district` is not a visible column here, so a match on
    // it would be invisible to the user and is not counted.
    expect(filterAndSortEntries(ROWS, LIST_FIELDS, titled, { ...emptyQuery, search: 'D10' })).toEqual([]);
  });
});
