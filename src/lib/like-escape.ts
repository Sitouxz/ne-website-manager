/**
 * Escapes a user's text for safe use inside a SQL `LIKE`/`ILIKE` pattern.
 *
 * `%` and `_` are wildcards there. Passing a search box's raw text straight
 * through means `report_v2` also matches `reportXv2`, and a lone `%` matches
 * every row — wrong results that look exactly like working results, which is
 * the worst failure mode a search can have.
 *
 * Backslashes are escaped FIRST. Doing it last would escape the backslashes
 * this function had just added, so `50%` would become a pattern matching a
 * literal backslash followed by anything.
 *
 * The caller still wraps the result in its own `%…%` for a contains-match;
 * this only neutralises wildcards inside the user's own text.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (ch) => `\\${ch}`);
}
