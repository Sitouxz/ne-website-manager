import { DAY_MS, utcDayKey } from '@/lib/dates';
import { dayKeyInTz, zonedMidnightUtc } from '@/lib/analytics/tz';

/**
 * Date-range selection for the Analytics screen. A range is always whole
 * calendar days, inclusive of both ends, in the client's timezone
 * (`clients.timezone`, Phase 1 item 12). Day arithmetic happens on
 * `YYYY-MM-DD` keys (treated as UTC dates purely as a day index); only the
 * final bounds are converted to real instants with `zonedMidnightUtc`, so
 * DST and non-UTC zones never shift a day boundary.
 */
export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

/** Longest range the screen and PDF will render (one year of daily bars). */
export const MAX_RANGE_DAYS = 366;

export type ResolvedRange = {
  /** First included day in `tz`, `YYYY-MM-DD`. */
  startKey: string;
  /** Last included day in `tz`, `YYYY-MM-DD`. */
  endKey: string;
  /** Number of whole days in the range. */
  days: number;
  /** Inclusive lower bound: midnight of `startKey` in `tz`. */
  start: Date;
  /** Exclusive upper bound: midnight of the day after `endKey` in `tz`. */
  endExclusive: Date;
  /** Human label, e.g. "1 Sep 2026 – 30 Sep 2026". */
  label: string;
  /** IANA zone the day boundaries are in. */
  tz: string;
};

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function keyToMs(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `key` shifted by `n` calendar days. */
export function addDays(key: string, n: number) {
  return utcDayKey(keyToMs(key) + n * DAY_MS);
}

export function isDayKey(value: string | null | undefined): value is string {
  if (!value || !KEY_RE.test(value)) return false;
  return utcDayKey(keyToMs(value)) === value; // rejects 2026-02-31 style overflow
}

export function fmtDayKey(key: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(keyToMs(key)).toLocaleDateString('en-SG', { ...opts, timeZone: 'UTC' });
}

/** Builds a range from two day keys (inclusive) in `tz`. */
export function rangeFromKeys(startKey: string, endKey: string, tz = 'UTC'): ResolvedRange {
  const days = Math.round((keyToMs(endKey) - keyToMs(startKey)) / DAY_MS) + 1;
  return {
    startKey,
    endKey,
    days,
    start: new Date(zonedMidnightUtc(startKey, tz)),
    endExclusive: new Date(zonedMidnightUtc(addDays(endKey, 1), tz)),
    label: days === 1 ? fmtDayKey(startKey) : `${fmtDayKey(startKey)} – ${fmtDayKey(endKey)}`,
    tz,
  };
}

/**
 * Resolves a preset (or custom from/to keys) to concrete days in `tz`.
 * - `today` and `Nd` presets end today (in `tz`) and cover N days.
 * - `this_month` / `last_month` cover the whole calendar month, so the current
 *   month shows days 1..31 with not-yet-elapsed days empty.
 * - `custom` uses `from`/`to` (swapped if reversed, clamped to MAX_RANGE_DAYS
 *   by pulling the start forward); invalid or missing keys fall back to 30 days.
 */
export function resolveRange(preset: RangePreset, nowMs: number, from?: string, to?: string, tz = 'UTC'): ResolvedRange {
  const today = dayKeyInTz(nowMs, tz);
  const [y, m] = today.split('-').map(Number);
  const monthKey = (year: number, month0: number, day: number) => utcDayKey(Date.UTC(year, month0, day));

  switch (preset) {
    case 'today': return rangeFromKeys(today, today, tz);
    case '7d': return rangeFromKeys(addDays(today, -6), today, tz);
    case '30d': return rangeFromKeys(addDays(today, -29), today, tz);
    case '90d': return rangeFromKeys(addDays(today, -89), today, tz);
    case 'this_month': return rangeFromKeys(monthKey(y, m - 1, 1), monthKey(y, m, 0), tz);
    case 'last_month': return rangeFromKeys(monthKey(y, m - 2, 1), monthKey(y, m - 1, 0), tz);
    case 'custom': {
      if (!isDayKey(from) || !isDayKey(to)) return rangeFromKeys(addDays(today, -29), today, tz);
      let a = from;
      let b = to;
      if (a > b) [a, b] = [b, a];
      if ((keyToMs(b) - keyToMs(a)) / DAY_MS + 1 > MAX_RANGE_DAYS) a = addDays(b, -(MAX_RANGE_DAYS - 1));
      return rangeFromKeys(a, b, tz);
    }
  }
}

export type CompareMode = 'none' | 'previous' | 'year';

export const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: 'none', label: 'No comparison' },
  { id: 'previous', label: 'vs previous period' },
  { id: 'year', label: 'vs same period last year' },
];

/**
 * The comparison window for `range`: the same number of days immediately
 * before it, or the same calendar dates one year earlier (29 Feb maps to
 * 28 Feb). Returns null for `none`.
 */
export function comparisonRange(range: ResolvedRange, mode: CompareMode): ResolvedRange | null {
  if (mode === 'none') return null;
  if (mode === 'previous') {
    return rangeFromKeys(addDays(range.startKey, -range.days), addDays(range.startKey, -1), range.tz);
  }
  const shiftYear = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return utcDayKey(Date.UTC(y - 1, m - 1, Math.min(d, lastDay)));
  };
  return rangeFromKeys(shiftYear(range.startKey), shiftYear(range.endKey), range.tz);
}
