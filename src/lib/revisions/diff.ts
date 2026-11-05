/**
 * Field-by-field comparison of a saved revision against the editor's
 * current state — what "Compare" in the history drawer shows before anyone
 * commits to a restore.
 *
 * Pure and dependency-free (no diff library): the inputs are small, the
 * rules are ours, and this keeps the behaviour unit-tested in one place for
 * the post, page and collection-entry editors alike.
 */

export type FieldKind = 'text' | 'html' | 'list' | 'value';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
}

export interface DiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
}

export interface FieldChange {
  key: string;
  label: string;
  kind: FieldKind;
  /** Display form of the revision's value. */
  before: string;
  /** Display form of the current value. */
  after: string;
  /** Word-level diff for text/html fields; absent when too large to compute. */
  segments?: DiffSegment[];
  /** True when the text was too long to diff word by word. */
  tooLarge?: boolean;
  /** For list fields: items present now but not in the revision. */
  added?: string[];
  /** For list fields: items in the revision but not present now. */
  removed?: string[];
}

/**
 * Word-diff budget, in LCS table cells (changed region before × after, after
 * the common prefix and suffix are trimmed). 4M cells is ~16 MB and about
 * 1,000 changed words a side once whitespace tokens are counted — plenty for
 * an edit, and a hard stop for a wholesale rewrite.
 */
const MAX_DIFF_CELLS = 4_000_000;

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};

/** Rich-text HTML to readable plain text: block tags become line breaks, everything else is dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Human display of any stored value: empty markers, Yes/No, joined lists, compact JSON. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Word-level diff via longest common subsequence. Whitespace is kept as its
 * own token so the output re-joins to the original text exactly. Returns
 * null when the inputs exceed the size budget.
 */
export function diffWords(before: string, after: string): DiffSegment[] | null {
  const a = tokenize(before);
  const b = tokenize(after);

  // Trim the common prefix/suffix first: most edits touch a small region,
  // and this keeps the LCS table proportional to the changed part.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length;
  const cols = midB.length;
  if (rows * cols > MAX_DIFF_CELLS) return null;
  const table: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };

  if (start > 0) push('same', a.slice(0, start).join(''));
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (midA[i] === midB[j]) { push('same', midA[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('removed', midA[i]); i++; }
    else { push('added', midB[j]); j++; }
  }
  while (i < rows) { push('removed', midA[i]); i++; }
  while (j < cols) { push('added', midB[j]); j++; }
  if (endA < a.length) push('same', a.slice(endA).join(''));

  return segments;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).filter(Boolean);
  const single = formatValue(value);
  return single ? [single] : [];
}

/**
 * Changed fields only, in `fields` order. Fields absent from `revision` are
 * skipped. `revision` is the saved snapshot,
 * `current` the editor's state in the same row shape; segments read as
 * "what changed since that version".
 */
export function diffSnapshot(
  revision: Record<string, unknown>,
  current: Record<string, unknown>,
  fields: FieldSpec[],
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of fields) {
    // A field the revision never recorded is unknown, not empty: autosave
    // snapshots omit status, and versions saved before a column existed omit
    // that column. Showing "Empty → published" there would be false.
    if (!(field.key in revision)) continue;
    const oldRaw = revision[field.key];
    const newRaw = current[field.key];

    if (field.kind === 'list') {
      const oldItems = asList(oldRaw);
      const newItems = asList(newRaw);
      const added = newItems.filter((item) => !oldItems.includes(item));
      const removed = oldItems.filter((item) => !newItems.includes(item));
      if (added.length === 0 && removed.length === 0) continue;
      changes.push({ ...field, before: oldItems.join(', '), after: newItems.join(', '), added, removed });
      continue;
    }

    const before = field.kind === 'html' ? htmlToText(String(oldRaw ?? '')) : formatValue(oldRaw);
    const after = field.kind === 'html' ? htmlToText(String(newRaw ?? '')) : formatValue(newRaw);
    if (before === after) continue;

    if (field.kind === 'text' || field.kind === 'html') {
      const segments = diffWords(before, after);
      changes.push(segments ? { ...field, before, after, segments } : { ...field, before, after, tooLarge: true });
    } else {
      changes.push({ ...field, before, after });
    }
  }

  return changes;
}

/** Fields compared for a post — mirrors the revisions route's POST_SNAPSHOT_FIELDS. */
export const POST_DIFF_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'slug', label: 'Web address', kind: 'value' },
  { key: 'status', label: 'Status', kind: 'value' },
  { key: 'excerpt', label: 'Excerpt', kind: 'text' },
  { key: 'content', label: 'Body', kind: 'html' },
  { key: 'category', label: 'Category', kind: 'value' },
  { key: 'tags', label: 'Tags', kind: 'list' },
  { key: 'cover_url', label: 'Featured image', kind: 'value' },
  { key: 'seo_title', label: 'Search headline', kind: 'text' },
  { key: 'seo_description', label: 'Search description', kind: 'text' },
  { key: 'og_image_url', label: 'Image when shared', kind: 'value' },
  { key: 'canonical_url', label: 'Canonical URL', kind: 'value' },
  { key: 'noindex', label: 'Hidden from search engines', kind: 'value' },
];

/** Fields compared for a page — mirrors the revisions route's PAGE_SNAPSHOT_FIELDS. */
export const PAGE_DIFF_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'path', label: 'Web address', kind: 'value' },
  { key: 'status', label: 'Status', kind: 'value' },
  { key: 'visibility', label: 'Visibility', kind: 'value' },
  { key: 'content', label: 'Body', kind: 'html' },
  { key: 'seo_title', label: 'Search headline', kind: 'text' },
  { key: 'seo_description', label: 'Search description', kind: 'text' },
  { key: 'og_image_url', label: 'Image when shared', kind: 'value' },
  { key: 'canonical_url', label: 'Canonical URL', kind: 'value' },
  { key: 'noindex', label: 'Hidden from search engines', kind: 'value' },
];

/**
 * Collection entries keep their fields in `data`, so the comparison is built
 * from the collection's own schema: one spec per field, keyed `data.<key>`,
 * plus the entry's slug and status. Use with `flattenEntry`.
 */
export function entryDiffFields(defs: { key: string; label: string; type: string }[]): FieldSpec[] {
  const kindFor = (type: string): FieldKind => {
    if (type === 'richtext') return 'html';
    if (type === 'text' || type === 'textarea') return 'text';
    if (type === 'multiselect' || type === 'gallery') return 'list';
    return 'value';
  };
  return [
    { key: 'slug', label: 'Web address', kind: 'value' },
    { key: 'status', label: 'Status', kind: 'value' },
    ...defs.map((def) => ({ key: `data.${def.key}`, label: def.label || def.key, kind: kindFor(def.type) })),
  ];
}

/** Lifts `data.*` keys to the top level so an entry row can be diffed with `entryDiffFields`. */
export function flattenEntry(row: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if ('slug' in row) flat.slug = row.slug;
  if ('status' in row) flat.status = row.status;
  const data = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(data)) flat[`data.${key}`] = value;
  return flat;
}
