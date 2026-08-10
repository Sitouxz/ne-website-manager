/**
 * Date helpers shared by the dashboard, the analytics screen and the
 * analytics-rollup cron.
 *
 * `DAY_MS` was declared independently in four files (twice as `86_400_000`,
 * once as `86400000`, once again in a test), and two derived computations were
 * copy-pasted alongside it: "how many whole days ago was this?" and "what UTC
 * calendar day does this timestamp belong to?". The second one matters more
 * than it looks — it produces the `analytics_daily.day` key (migration 020),
 * so the rollup cron writing it and the screens reading it have to agree
 * exactly. Three separate `.toISOString().slice(0, 10)` calls agreeing by
 * coincidence is not the same as agreeing by construction.
 *
 * Pure and dependency-free: usable from Server Components, client components
 * and route handlers alike.
 */

/** Milliseconds in a day. */
export const DAY_MS = 86_400_000;

/**
 * The UTC calendar day a timestamp falls in, as `YYYY-MM-DD` — the exact
 * format stored in `analytics_daily.day` and compared against with `gte`.
 *
 * Deliberately UTC, not local: the rollup cron buckets by UTC day, so a
 * local-timezone key would silently mismatch the stored rows for any client
 * outside UTC (every client this CMS has).
 */
export function utcDayKey(value: Date | number | string): string {
  const date =
    value instanceof Date ? value
    : typeof value === 'number' ? new Date(value)
    : new Date(value);
  return date.toISOString().slice(0, 10);
}

/**
 * Whole days elapsed between `iso` and `nowMs`, rounded down. Used for
 * "14 days old" style ageing. Returns 0 for a future timestamp rather than a
 * negative count, since every caller is asking "how old is this?" and a
 * negative age has no meaning in that question.
 */
export function daysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((nowMs - then) / DAY_MS));
}

/**
 * The UTC day key `days` days before `from` — i.e. the lower bound of an
 * inclusive N-day window ending today. `daysAgoKey(30, now)` with
 * `SPARKLINE_DAYS = 30` yields the first of the 30 days being charted.
 */
export function daysAgoKey(days: number, from: Date | number = Date.now()): string {
  const fromMs = from instanceof Date ? from.getTime() : from;
  return utcDayKey(fromMs - days * DAY_MS);
}

/** Midnight UTC on the calendar day `value` falls in. */
export function startOfUtcDay(value: Date | number = Date.now()): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
