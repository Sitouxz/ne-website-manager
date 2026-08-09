/**
 * Works out where a media file is actually used, so the CMS can warn before
 * someone deletes an image that is on their live website.
 *
 * Deleting media used to be a one-click action behind a `window.confirm` that
 * said "This cannot be undone" — true, but it never mentioned that the file
 * might be the hero image on the homepage. The person finds out when a client
 * emails them a screenshot of a broken image. This module is what lets the
 * delete dialog say "Used in 3 places, 2 of them live" instead.
 *
 * Matching is by URL substring. A media row's `url` is the Storage public URL
 * and that exact string is what gets embedded into post/page HTML, into an
 * `image`/`gallery` field's `{ url, alt }` value, and into `properties.hero_url`
 * — so a substring scan finds every reference without needing per-field
 * knowledge of each content shape. It cannot produce a false negative for a
 * normally-inserted image; it can in principle produce a false positive if one
 * URL is a prefix of another, which Storage's generated paths make unlikely,
 * and which errs on the safe side anyway (warning about one file too many is
 * better than silently breaking a page).
 *
 * The scanning functions are pure and take already-fetched rows, so they're
 * directly testable and the route stays a thin data-fetching shell.
 */

export type UsageEntityType = 'post' | 'page' | 'property' | 'entry';

export interface MediaUsage {
  entityType: UsageEntityType;
  id: string;
  /** Human title for display — falls back to the slug, then a placeholder. */
  title: string;
  /** Whether this usage is visible to website visitors right now. */
  isLive: boolean;
  /** Editor URL within the CMS, so the warning can link straight to it. */
  href: string;
}

/** A row shape loose enough to accept any of the content tables. */
type ContentRow = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** True when `url` appears anywhere in the row's serialized content. */
function rowMentions(row: ContentRow, url: string, fields: string[]): boolean {
  if (!url) return false;
  for (const field of fields) {
    const value = row[field];
    if (value == null) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.includes(url)) return true;
  }
  return false;
}

export function findPostUsages(rows: ContentRow[], url: string): MediaUsage[] {
  return rows
    .filter((row) => rowMentions(row, url, ['cover_url', 'content', 'content_json']))
    .map((row) => ({
      entityType: 'post' as const,
      id: str(row.id),
      title: str(row.title) || str(row.slug) || '(Untitled post)',
      isLive: row.status === 'published',
      href: `/cms/posts/${str(row.id)}`,
    }));
}

export function findPageUsages(rows: ContentRow[], url: string): MediaUsage[] {
  return rows
    .filter((row) => rowMentions(row, url, ['content', 'content_json']))
    .map((row) => ({
      entityType: 'page' as const,
      id: str(row.id),
      title: str(row.title) || str(row.path) || '(Untitled page)',
      isLive: row.status === 'published' && row.visibility === 'public',
      href: `/cms/pages/${str(row.id)}`,
    }));
}

export function findPropertyUsages(rows: ContentRow[], url: string): MediaUsage[] {
  return rows
    .filter((row) => rowMentions(row, url, ['hero_url', 'gallery', 'story', 'tour']))
    .map((row) => ({
      entityType: 'property' as const,
      id: str(row.id),
      title: str(row.name) || str(row.slug) || '(Untitled property)',
      isLive: row.status === 'active',
      href: `/cms/properties/${str(row.id)}`,
    }));
}

export function findEntryUsages(
  rows: ContentRow[],
  url: string,
  collectionSlugById: Record<string, string> = {}
): MediaUsage[] {
  return rows
    .filter((row) => rowMentions(row, url, ['data']))
    .map((row) => {
      const collectionId = str(row.collection_id);
      const data = (row.data ?? {}) as Record<string, unknown>;
      return {
        entityType: 'entry' as const,
        id: str(row.id),
        title: str(data.title) || str(data.name) || str(row.slug) || '(Untitled entry)',
        isLive: row.status === 'published',
        href: `/cms/collections/${collectionSlugById[collectionId] ?? collectionId}/entries/${str(row.id)}`,
      };
    });
}

const ENTITY_NOUNS: Record<UsageEntityType, { one: string; many: string }> = {
  post: { one: 'blog post', many: 'blog posts' },
  page: { one: 'page', many: 'pages' },
  property: { one: 'property', many: 'properties' },
  entry: { one: 'entry', many: 'entries' },
};

function countPhrase(count: number, type: UsageEntityType): string {
  const noun = count === 1 ? ENTITY_NOUNS[type].one : ENTITY_NOUNS[type].many;
  return `${count} ${noun}`;
}

/** Joins with commas and a final "and": ["a","b","c"] -> "a, b and c". */
function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Turns a usage list into the plain-language warning lines shown in the delete
 * dialog. Written for someone who has never heard the word "reference": it
 * says what breaks on their website, not what the data model contains.
 */
export function describeUsage(usages: MediaUsage[]): string[] {
  if (usages.length === 0) {
    return ["This file isn't used anywhere, so nothing on your website will change."];
  }

  const byType = new Map<UsageEntityType, number>();
  for (const usage of usages) {
    byType.set(usage.entityType, (byType.get(usage.entityType) ?? 0) + 1);
  }
  const parts = [...byType.entries()].map(([type, count]) => countPhrase(count, type));

  const lines = [`This file is used in ${joinNatural(parts)}.`];

  const live = usages.filter((u) => u.isLive);
  if (live.length > 0) {
    const names = live.slice(0, 3).map((u) => `"${u.title}"`);
    const more = live.length > 3 ? `, and ${live.length - 3} more` : '';
    lines.push(
      live.length === 1
        ? `It will break on your live website, where it appears in ${names[0]}.`
        : `It will break in ${live.length} places on your live website, including ${joinNatural(names)}${more}.`
    );
  } else {
    lines.push('None of those are published yet, so visitors will not see a broken image.');
  }

  lines.push('Replace the image in those places first if you want to avoid a gap.');
  return lines;
}
