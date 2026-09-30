import { DAY_MS, utcDayKey } from '@/lib/dates';

/**
 * Date-range selection for the Analytics screen. Everything is in UTC calendar
 * days (matching how events are bucketed and how `analytics_daily.day` is
 * written), and a range is always whole days, inclusive of both ends.
 */
export type RangePreset = '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
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
  /** First included UTC day, `YYYY-MM-DD`. */
  startKey: string;
  /** Last included UTC day, `YYYY-MM-DD`. */
  endKey: string;
  /** Number of whole days in the range. */
  days: number;
  /** Inclusive lower bound: UTC midnight of `startKey`. */
  start: Date;
  /** Exclusive upper bound: UTC midnight of the day after `endKey`. */
  endExclusive: Date;
  /** Human label, e.g. "1 Sep 2026 – 30 Sep 2026". */
  label: string;
};

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function keyToMs(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isDayKey(value: string | null | undefined): value is string {
  if (!value || !KEY_RE.test(value)) return false;
  return utcDayKey(keyToMs(value)) === value; // rejects 2026-02-31 style overflow
}

function fmtKey(key: string) {
  return new Date(keyToMs(key)).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function build(startMs: number, endMs: number): ResolvedRange {
  const days = Math.round((endMs - startMs) / DAY_MS) + 1;
  const startKey = utcDayKey(startMs);
  const endKey = utcDayKey(endMs);
  return {
    startKey,
    endKey,
    days,
    start: new Date(startMs),
    endExclusive: new Date(endMs + DAY_MS),
    label: days === 1 ? fmtKey(startKey) : `${fmtKey(startKey)} – ${fmtKey(endKey)}`,
  };
}

/**
 * Resolves a preset (or custom from/to keys) to concrete UTC days.
 * - `Nd` presets end today and cover N days.
 * - `this_month` / `last_month` cover the whole calendar month, so the current
 *   month shows days 1..31 with not-yet-elapsed days empty.
 * - `custom` uses `from`/`to` (swapped if reversed, clamped to MAX_RANGE_DAYS
 *   by pulling the start forward); invalid or missing keys fall back to 30 days.
 */
export function resolveRange(preset: RangePreset, nowMs: number, from?: string, to?: string): ResolvedRange {
  const now = new Date(nowMs);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  switch (preset) {
    case '7d': return build(todayMs - 6 * DAY_MS, todayMs);
    case '30d': return build(todayMs - 29 * DAY_MS, todayMs);
    case '90d': return build(todayMs - 89 * DAY_MS, todayMs);
    case 'this_month': {
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      return build(Date.UTC(y, m, 1), Date.UTC(y, m + 1, 0));
    }
    case 'last_month': {
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();
      return build(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 0));
    }
    case 'custom': {
      if (!isDayKey(from) || !isDayKey(to)) return build(todayMs - 29 * DAY_MS, todayMs);
      let a = keyToMs(from);
      let b = keyToMs(to);
      if (a > b) [a, b] = [b, a];
      if ((b - a) / DAY_MS + 1 > MAX_RANGE_DAYS) a = b - (MAX_RANGE_DAYS - 1) * DAY_MS;
      return build(a, b);
    }
  }
}
