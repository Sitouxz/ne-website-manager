import type { CollectionItemStatus, CollectionOptions, CollectionSortDefault } from '@/lib/supabase/types';
import type { FieldDef } from './types';

/**
 * Beyond three, extra columns squeeze the entry title — the one thing every
 * row needs — into an unreadable sliver, and the row stops being scannable.
 * Configuring more is not an error; the rest are simply not rendered.
 */
export const MAX_LIST_COLUMNS = 3;

/** Plain-language names for the ordering presets, shown in both the schema
 *  builder's picker and the entries list's "why can't I drag" explanation. */
export const SORT_LABELS: Record<CollectionSortDefault, string> = {
  manual:           'Manual order',
  newest:           'Newest first',
  oldest:           'Oldest first',
  recently_updated: 'Recently updated',
  title:            'Name A–Z',
};

/**
 * Renders one `collection_items.data` value as a short, human-readable string
 * for list columns, filter chips and collapsed summaries.
 *
 * This is display-only and deliberately lossy: a gallery becomes "4 images",
 * a repeater becomes "3 items". A list column exists to help someone find the
 * right row, not to reproduce the record — anything that needs the real value
 * opens the entry.
 *
 * Returns `''` for a value that isn't set, so a caller can render its own
 * placeholder (an em dash, usually) rather than the word "undefined".
 */

const DEFAULT_MAX_LENGTH = 60;

export function formatFieldValue(def: FieldDef, value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
  if (value === undefined || value === null || value === '') return '';

  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number') return truncate(String(value), maxLength);
      const { precision, prefix, suffix } = def.format ?? {};
      const body = precision === undefined ? String(value) : value.toFixed(precision);
      return `${prefix ?? ''}${body}${suffix ? ` ${suffix}` : ''}`;
    }

    case 'boolean':
      return value ? 'Yes' : 'No';

    case 'multiselect':
    case 'taglist':
      if (!Array.isArray(value)) return '';
      return truncate(value.filter((v) => typeof v === 'string').join(', '), maxLength);

    case 'gallery': {
      if (!Array.isArray(value)) return '';
      if (value.length === 0) return '';
      return `${value.length} ${value.length === 1 ? 'image' : 'images'}`;
    }

    case 'repeater': {
      if (!Array.isArray(value)) return '';
      if (value.length === 0) return '';
      return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
    }

    case 'image': {
      const image = value as { url?: unknown; alt?: unknown };
      if (typeof image.alt === 'string' && image.alt.trim() !== '') return truncate(image.alt, maxLength);
      return typeof image.url === 'string' && image.url !== '' ? 'Image' : '';
    }

    case 'richtext': {
      const rich = value as { html?: unknown };
      if (typeof rich.html !== 'string') return '';
      // Tags stripped rather than rendered: this lands in a table cell, and
      // the CMS must never inject stored HTML into its own chrome.
      const text = rich.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return truncate(text, maxLength);
    }

    case 'json':
      // No useful one-line form, and stringifying it fills the column with
      // punctuation. The entry editor is where JSON is read.
      return '—';

    default:
      return truncate(String(value), maxLength);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}…`;
}

/**
 * The distinct values a field takes across a set of entries, for building a
 * filter dropdown.
 *
 * For `select` the schema already knows the vocabulary, but the data may not
 * use all of it — offering an option that matches nothing is worse than
 * offering fewer, so options are always derived from the entries themselves.
 * `multiselect` and `taglist` contribute each of their array members
 * separately, since filtering on "has this tag" is the only useful question.
 */
export function distinctValues(def: FieldDef, rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();

  for (const row of rows) {
    const value = row[def.key];
    if (value === undefined || value === null || value === '') continue;

    if (def.type === 'multiselect' || def.type === 'taglist') {
      if (!Array.isArray(value)) continue;
      for (const member of value) if (typeof member === 'string' && member !== '') seen.add(member);
      continue;
    }

    if (def.type === 'boolean') {
      seen.add(value ? 'Yes' : 'No');
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number') seen.add(String(value));
  }

  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'en'));
}

/** Whether `row` matches `selected` for `def`, using the same rules as `distinctValues`. */
export function matchesFilter(def: FieldDef, row: Record<string, unknown>, selected: string): boolean {
  const value = row[def.key];
  if (value === undefined || value === null || value === '') return false;

  if (def.type === 'multiselect' || def.type === 'taglist') {
    return Array.isArray(value) && value.some((member) => String(member) === selected);
  }
  if (def.type === 'boolean') return (value ? 'Yes' : 'No') === selected;
  return String(value) === selected;
}

/**
 * Which field types can serve as a list filter. A filter is only useful when
 * a field takes a small number of repeated values — free text, dates, media
 * and rich text all produce a dropdown with one option per entry, which is
 * just a worse version of the search box.
 */
export const FILTERABLE_TYPES = new Set<FieldDef['type']>(['select', 'multiselect', 'taglist', 'boolean']);

// ---------------------------------------------------------------------------
// Entries list: resolving configured columns/filters, and applying them.
// Kept here rather than inline in the entries page so the behaviour that
// decides what an editor actually sees is unit-testable without mounting a
// page that talks to Supabase.
// ---------------------------------------------------------------------------

/** The subset of `CollectionItem` this module needs. */
export interface EntryLike {
  slug: string;
  status: CollectionItemStatus;
  data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * An entry's display name: `data[title_field]` when the collection configures
 * one and the entry has a value for it, else the slug. There is no
 * denormalized title column on `collection_items` (see migration 007).
 */
export function deriveEntryTitle(item: EntryLike, titleField: string | undefined): string {
  if (titleField) {
    const value = item.data?.[titleField];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return item.slug || '(untitled)';
}

/**
 * Configured column keys resolved against the live schema. A key naming a
 * field that has since been deleted is dropped rather than rendering a
 * permanently empty column, and the list is capped at `MAX_LIST_COLUMNS`.
 */
export function resolveListColumns(fields: FieldDef[], options: CollectionOptions | null | undefined): FieldDef[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return (options?.list_columns ?? [])
    .map((key) => byKey.get(key))
    .filter((f): f is FieldDef => !!f)
    .slice(0, MAX_LIST_COLUMNS);
}

/** As `resolveListColumns`, and additionally drops fields whose type can't filter. */
export function resolveListFilters(fields: FieldDef[], options: CollectionOptions | null | undefined): FieldDef[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return (options?.list_filters ?? [])
    .map((key) => byKey.get(key))
    .filter((f): f is FieldDef => !!f && FILTERABLE_TYPES.has(f.type));
}

export interface EntryListQuery {
  search: string;
  status: CollectionItemStatus | 'all';
  /** Keyed by `FieldDef.key`; `''` means no filter on that field. */
  fieldFilters: Record<string, string>;
}

export function hasActiveQuery(query: EntryListQuery): boolean {
  return query.search.trim() !== ''
    || query.status !== 'all'
    || Object.values(query.fieldFilters).some((v) => v !== '');
}

/**
 * Applies the toolbar query and the collection's default ordering.
 *
 * Search covers the title, the slug and any configured column — deliberately
 * not every field. Matching on a field the row doesn't display leaves the
 * user staring at a result with no visible reason for being there.
 *
 * `manual` ordering returns the input order untouched, because the caller
 * fetches by `sort_order` already; re-sorting here would need `sort_order` to
 * be duplicated into this module for no gain.
 */
export function filterAndSortEntries<T extends EntryLike>(
  items: T[],
  fields: FieldDef[],
  options: CollectionOptions | null | undefined,
  query: EntryListQuery,
): T[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const titleField = options?.title_field;
  const listColumns = resolveListColumns(fields, options);
  const sortMode: CollectionSortDefault = options?.sort_default ?? 'manual';
  const searchTerm = query.search.trim().toLowerCase();
  const activeFieldFilters = Object.entries(query.fieldFilters).filter(([, value]) => value !== '');

  const filtered = items.filter((item) => {
    if (query.status !== 'all' && item.status !== query.status) return false;

    for (const [key, value] of activeFieldFilters) {
      const field = byKey.get(key);
      if (!field) continue;
      if (!matchesFilter(field, item.data ?? {}, value)) return false;
    }

    if (searchTerm === '') return true;
    const haystack = [
      deriveEntryTitle(item, titleField),
      item.slug,
      ...listColumns.map((f) => formatFieldValue(f, item.data?.[f.key])),
    ].join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  });

  if (sortMode === 'manual') return filtered;

  // Copied before sorting: `filter` already returned a new array, but making
  // that non-obvious property load-bearing is how an in-place sort of the
  // caller's state array eventually sneaks in.
  return [...filtered].sort((a, b) => {
    switch (sortMode) {
      case 'newest': return b.created_at.localeCompare(a.created_at);
      case 'oldest': return a.created_at.localeCompare(b.created_at);
      case 'recently_updated': return b.updated_at.localeCompare(a.updated_at);
      case 'title': return deriveEntryTitle(a, titleField).localeCompare(deriveEntryTitle(b, titleField), 'en');
      default: return 0;
    }
  });
}

/**
 * Whether drag-to-reorder should be offered. Dragging writes `sort_order`,
 * which is only what the list shows under manual ordering — under any other
 * order, or while a filter hides rows, a drop would reorder against rows the
 * user cannot see.
 */
export function canReorderEntries(options: CollectionOptions | null | undefined, query: EntryListQuery): boolean {
  return (options?.sort_default ?? 'manual') === 'manual' && !hasActiveQuery(query);
}
