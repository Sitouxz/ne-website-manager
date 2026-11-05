import type { FieldDef } from './types';

/**
 * Making a schema edit answerable for the content already behind it.
 *
 * The schema builder started as add / remove / reorder over a `FieldDef[]`,
 * with no knowledge of `collection_items` at all. That is fine while a
 * collection is being designed and holds nothing, and quietly destructive
 * afterwards: removing a field dropped it from the schema, left every
 * entry's value stranded under a key nothing would ever read again, and
 * removed it from the next SDK type generation — so the live site lost it
 * too. There was no count, no confirmation, and no way back except re-adding
 * the key at its exact original spelling.
 *
 * This module supplies the three things that were missing, as pure
 * functions so the builder can ask its questions before it does anything:
 *
 *  1. **Count first** (`countFieldUsage`) — how many entries actually hold
 *     content here, and how many of those are published (i.e. how much of
 *     this is on a live website right now).
 *  2. **Hide instead of delete** (`deprecated` on `FieldDef`) — the field
 *     leaves the entry editor but stays in the data and in the generated
 *     SDK types, so a client site referencing it keeps compiling and keeps
 *     rendering. Deletion becomes a second, later, deliberate act.
 *  3. **Rename properly** (`renameFieldInSchema` / `renameKeyInData`) — the
 *     builder's documented workaround for a mistyped key was remove +
 *     re-add, which is precisely the destructive path. A rename carries the
 *     content across.
 *
 * The industry name for the posture is additive-first: add before you
 * remove, deprecate before you delete, and never let a schema edit silently
 * change what a published page shows.
 */

/** The subset of a `collection_items` row this module needs. */
export interface UsageEntry {
  data: Record<string, unknown> | null;
  status: string;
}

export interface FieldUsage {
  /** Entries in the collection, whatever their status. */
  total: number;
  /** Entries holding a non-empty value under this key. */
  withContent: number;
  /** Of those, the ones that are live on the website right now. */
  publishedWithContent: number;
}

/**
 * Whether a stored value counts as content worth warning about.
 *
 * Deliberately stricter than a truthiness check in two places, both learned
 * from what entry data actually looks like:
 *
 *  - `0` and `false` ARE content. A price of 0 or a "featured: false" is a
 *    deliberate answer, and warning "no entries use this field" about a
 *    collection full of zeroes would be a lie that costs someone their data.
 *  - An empty array, an empty object, and a whitespace-only string are NOT.
 *    A `taglist` the editor opened and never filled in stores `[]`, and a
 *    `richtext` field that was focused and cleared can store `"<p></p>"` —
 *    counting those inflates every warning until people stop reading them.
 */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return stripEmptyMarkup(value).trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Tiptap serialises an emptied rich-text field as an empty paragraph rather
 * than an empty string. Treating `"<p></p>"` (and its `<br>`/`&nbsp;`
 * variants) as content would mean every entry ever opened counts as using
 * every rich-text field in the schema.
 */
function stripEmptyMarkup(value: string): string {
  return value.replace(/<p>(\s|<br\s*\/?>|&nbsp;)*<\/p>/gi, '').replace(/&nbsp;/gi, ' ');
}

export function countFieldUsage(entries: UsageEntry[], key: string): FieldUsage {
  let withContent = 0;
  let publishedWithContent = 0;

  for (const entry of entries) {
    if (!entry.data || !hasContent(entry.data[key])) continue;
    withContent += 1;
    if (entry.status === 'published') publishedWithContent += 1;
  }

  return { total: entries.length, withContent, publishedWithContent };
}

/**
 * One line an administrator can act on, in the product's established voice:
 * name the consequence on the live website, not the rule being broken (the
 * same standard `src/lib/publish-checks.ts` sets for its warnings).
 *
 * Returns `null` when nothing is at stake, so the caller can skip the
 * confirmation entirely — a field with no content behind it should not make
 * someone read a scary dialog to remove a typo.
 */
export function describeFieldRemoval(usage: FieldUsage, label: string): string | null {
  if (usage.withContent === 0) return null;

  const one = usage.withContent === 1;
  const base = `${usage.withContent} ${one ? 'entry' : 'entries'} of ${usage.total} ${one ? 'has' : 'have'} content in "${label}".`;

  const live = usage.publishedWithContent;
  if (live > 0) {
    const liveOne = live === 1;
    return `${base} ${live} of ${one ? 'them' : 'those'} ${liveOne ? 'is' : 'are'} published, so that content disappears from the website the next time ${liveOne ? 'that page is' : 'those pages are'} rebuilt.`;
  }

  return `${base} Removing the field leaves that content unreachable.`;
}

/** A field an editor should still be shown. Deprecated fields are kept, not rendered. */
export function isVisibleField(field: FieldDef): boolean {
  return field.deprecated !== true;
}

/**
 * The fields an entry editor renders, a publish check inspects, and a list
 * view may show. Everything that reads a schema *for a human* goes through
 * here; everything that reads it *for a machine* (SDK type generation, the
 * public API's response shape) deliberately does not, which is the whole
 * point of deprecation — the website keeps receiving the field after the
 * editor stops offering it.
 */
export function visibleFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter(isVisibleField);
}

export function setFieldDeprecated(fields: FieldDef[], key: string, deprecated: boolean): FieldDef[] {
  return fields.map((field) =>
    field.key === key
      ? { ...field, deprecated: deprecated ? true : undefined }
      : field,
  );
}

/**
 * ## Why a rename is a copy and a drop, not a rename
 *
 * Renaming a field means changing one row in `collections` and N rows in
 * `collection_items`, and the Supabase client cannot wrap those in a
 * transaction. The obvious implementation — rewrite each entry's key, then
 * update the schema — has a window in which the schema still names `oldKey`
 * while entries only carry `newKey`. An editor who opens an entry inside
 * that window sees the field as empty, and saving writes that emptiness
 * back. The mirror order (schema first) has the same hole in the other
 * direction.
 *
 * So the migration runs in three phases, and the invariant it maintains is
 * that **the key the schema currently names is always populated**:
 *
 *   1. `copyKeyInData` — write `newKey` alongside `oldKey`. The schema still
 *      names `oldKey`, which is still there. Nothing observable changes.
 *   2. Update the schema to `newKey`. It is already populated everywhere.
 *   3. `dropKeyInData` — remove `oldKey`. Cosmetic; a failure here leaves a
 *      harmless duplicate that a re-run clears.
 *
 * A failure at any phase is safe to re-run, and no phase can leave an entry
 * looking empty. Both functions are therefore idempotent, and phase 1
 * refuses to overwrite an existing `newKey` — on a re-run that value is the
 * live one and `oldKey` is the stale copy.
 *
 * Key order is preserved. `data` renders in schema order rather than key
 * order, but a JSONB diff is far easier to read when the only change is the
 * name of one key.
 */
export function copyKeyInData(
  data: Record<string, unknown> | null,
  oldKey: string,
  newKey: string,
): { data: Record<string, unknown>; changed: boolean } {
  const source = data ?? {};
  if (!(oldKey in source) || newKey in source) return { data: source, changed: false };

  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    next[k] = v;
    // Insert the copy immediately after its original rather than appending,
    // so the diff shows one added line next to its source.
    if (k === oldKey) next[newKey] = v;
  }
  return { data: next, changed: true };
}

export function dropKeyInData(
  data: Record<string, unknown> | null,
  key: string,
): { data: Record<string, unknown>; changed: boolean } {
  const source = data ?? {};
  if (!(key in source)) return { data: source, changed: false };
  const next = { ...source };
  delete next[key];
  return { data: next, changed: true };
}

export function renameFieldInSchema(
  fields: FieldDef[],
  oldKey: string,
  newKey: string,
  newLabel?: string,
): FieldDef[] {
  return fields.map((field) =>
    field.key === oldKey
      ? { ...field, key: newKey, label: newLabel?.trim() || field.label }
      : field,
  );
}

/**
 * The display options that name field keys by string (`title_field`,
 * `list_columns`, `list_filters`). A rename that updates the schema but not
 * these silently empties a collection's list view — the columns still name
 * a key, just not one that exists any more, which renders as a table of
 * blank cells rather than as an error.
 */
export function renameKeyInOptions<T extends {
  title_field?: string;
  list_columns?: string[];
  list_filters?: string[];
}>(options: T, oldKey: string, newKey: string): T {
  return {
    ...options,
    title_field: options.title_field === oldKey ? newKey : options.title_field,
    list_columns: options.list_columns?.map((k) => (k === oldKey ? newKey : k)),
    list_filters: options.list_filters?.map((k) => (k === oldKey ? newKey : k)),
  };
}

export type RenameCheck = { ok: true } | { ok: false; error: string };

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Guards a rename before any row is touched. `validateFieldDefs` would catch
 * a bad key eventually, but only after the data migration had already run
 * against every entry — the check has to come first.
 */
export function checkRename(fields: FieldDef[], oldKey: string, newKey: string): RenameCheck {
  if (!fields.some((f) => f.key === oldKey)) {
    return { ok: false, error: `No field with the key "${oldKey}".` };
  }
  if (newKey === oldKey) {
    return { ok: false, error: 'The new key is the same as the current one.' };
  }
  if (!KEY_PATTERN.test(newKey)) {
    return { ok: false, error: 'Keys use lowercase letters, numbers and underscores, and start with a letter.' };
  }
  if (fields.some((f) => f.key === newKey)) {
    return { ok: false, error: `Key "${newKey}" is already used by another field.` };
  }
  return { ok: true };
}
