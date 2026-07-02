/**
 * Parses `limit`/`offset` query params for the public client-facing list
 * routes (`posts`, `pages`, `properties`, and future ones).
 *
 * Design decisions (see task-1.3 report for full rationale):
 *  - `limit`: an out-of-range (negative) or non-numeric value falls back to
 *    `defaultLimit` rather than clamping to 0. There's no natural "floor"
 *    for limit the way there is for offset — silently returning zero rows
 *    for a garbled `limit` value would produce a confusing, misleading
 *    empty response for a public API. A valid value above `maxLimit` is
 *    clamped down to `maxLimit`. An explicit `limit=0` is honored as-is
 *    (it's a deliberate, meaningful request for zero rows — e.g. a caller
 *    that only wants the `X-Total-Count` header).
 *  - `offset`: a negative or non-numeric value clamps to `0`. Offset has a
 *    well-defined floor — "before the start" naturally means "start from
 *    the beginning" — so clamping (rather than falling back to a default)
 *    is the more intuitive behavior here.
 *  - `defaultLimit` itself is never clamped against `maxLimit`. This lets a
 *    route express "unbounded by default, capped only when the caller
 *    explicitly opts into paging" by passing a `defaultLimit` larger than
 *    `maxLimit` (used by the `pages` route, which historically had no cap
 *    at all when called with no params).
 */

export interface PaginationOptions {
  /** Applied when the `limit` query param is absent, negative, or non-numeric. */
  defaultLimit: number;
  /** Ceiling an explicit, valid `limit` query param is clamped down to. */
  maxLimit: number;
}

export interface PaginationResult {
  limit: number;
  offset: number;
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

export function parsePagination(url: URL, options: PaginationOptions): PaginationResult {
  const { defaultLimit, maxLimit } = options;
  const params = url.searchParams;

  const parsedLimit = parseNonNegativeInt(params.get('limit'));
  const limit = parsedLimit === null ? defaultLimit : Math.min(parsedLimit, maxLimit);

  const parsedOffset = parseNonNegativeInt(params.get('offset'));
  const offset = parsedOffset === null ? 0 : parsedOffset;

  return { limit, offset };
}
