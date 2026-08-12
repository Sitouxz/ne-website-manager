/**
 * Naming for duplicated content.
 *
 * The same "append `-copy-N`" logic now runs in three list pages (entries,
 * posts, pages), each of which had its own inline copy of a regex built by
 * string interpolation — the kind of thing that is identical until one of them
 * quietly isn't. It is also the only part of duplication with edge cases worth
 * testing, and it needs no database.
 *
 * The suffix goes on the URL-ish identifier (`slug` for entries and posts,
 * `path` for pages) because those carry a uniqueness constraint per client;
 * the human-readable title just gets "(copy)" and is allowed to collide.
 */

/** Escapes a string for literal use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The next free `${base}-copy-N` given everything that already exists.
 *
 * N is one past the highest existing copy rather than "count of copies plus
 * one": deleting `-copy-1` and then duplicating again must not try to reuse
 * that name, because a unique index would reject it and the user would see a
 * database error for an action that should always work.
 *
 * Only direct copies of `base` count. `about-us-copy-1` is not a copy of
 * `about`, and treating it as one would push `about`'s first copy to `-copy-2`
 * for no reason a user could explain.
 */
export function nextCopySlug(base: string, existing: string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(base)}-copy-(\\d+)$`);

  const highest = existing.reduce((max, candidate) => {
    const match = pattern.exec(candidate);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `${base}-copy-${highest + 1}`;
}

/** `"About us"` -> `"About us (copy)"`, with a fallback for untitled content. */
export function copyTitle(title: string | null | undefined, fallback = '(Untitled)'): string {
  const base = title?.trim() ? title : fallback;
  return `${base} (copy)`;
}
