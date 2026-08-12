import type { FieldDef } from '@/lib/collections/types';
import type { SeoAuditRow } from './audit';

/**
 * ## SEO convention for collection entries
 *
 * `posts` and `pages` carry `seo_title`/`seo_description` as real columns.
 * `collection_items` has neither, and adding them would be a native-table
 * change of exactly the kind Stage 0 of the multi-tenancy plan forbids. So
 * per-entry SEO lives in `data` under two RESERVED `FieldDef.key` values:
 *
 *   - `seo_title`
 *   - `seo_description`
 *
 * A collection opts in by declaring fields with those keys in its schema.
 * That opt-in is the whole design:
 *
 *  - A collection that declares neither is not audited at all. The
 *    alternative — auditing every collection — would tell a mosque
 *    administrator that all 40 of their prayer-time entries are "missing SEO"
 *    the moment the feature shipped, for content that has no public page of
 *    its own and never needed a meta description.
 *  - A collection that declares them is audited exactly like a post or page,
 *    through the same `isMissingSeo` rule, so there is one definition of
 *    "missing SEO" across the product rather than two that drift.
 *
 * Both keys are ordinary fields otherwise: they render in the entry editor
 * through `FieldInput` like anything else, and reach a client site in `data`
 * with no special casing in the SDK.
 */

export const SEO_TITLE_KEY = 'seo_title';
export const SEO_DESCRIPTION_KEY = 'seo_description';

/** The reserved keys, for the schema builder to flag as meaningful. */
export const RESERVED_SEO_KEYS: readonly string[] = [SEO_TITLE_KEY, SEO_DESCRIPTION_KEY];

/**
 * Whether a collection has opted into SEO auditing by declaring either
 * reserved field. Either alone is enough — a collection that defines a title
 * but no description has opted in and should be told the description is
 * missing, which is the entire point of the audit.
 */
export function collectionHasSeoFields(fields: FieldDef[] | null | undefined): boolean {
  if (!fields) return false;
  return fields.some((f) => f.key === SEO_TITLE_KEY || f.key === SEO_DESCRIPTION_KEY);
}

/** Reads a `data` value as a trimmed string, or null when it is absent or not text. */
function readString(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Adapts an entry to the shape `isMissingSeo`/`countMissingSeo` already take,
 * so entries flow through the same audit as posts and pages instead of
 * growing a parallel rule.
 */
export function entrySeoRow(item: { id: string; data: Record<string, unknown> | null }): SeoAuditRow {
  return {
    id: item.id,
    seo_title: readString(item.data, SEO_TITLE_KEY),
    seo_description: readString(item.data, SEO_DESCRIPTION_KEY),
  };
}

/**
 * The auditable entries across a set of collections: every entry belonging to
 * a collection that opted in, paired with its collection so a caller can build
 * a link and a label. Entries of collections that never declared the reserved
 * fields are dropped here, not filtered downstream, so no caller can
 * accidentally re-introduce the "everything is missing SEO" noise.
 */
export function auditableEntries<
  C extends { id: string; fields: FieldDef[] },
  E extends { id: string; collection_id: string; data: Record<string, unknown> | null },
>(collections: C[], entries: E[]): { collection: C; entry: E }[] {
  const opted = new Map(
    collections.filter((c) => collectionHasSeoFields(c.fields)).map((c) => [c.id, c]),
  );

  const out: { collection: C; entry: E }[] = [];
  for (const entry of entries) {
    const collection = opted.get(entry.collection_id);
    if (collection) out.push({ collection, entry });
  }
  return out;
}
