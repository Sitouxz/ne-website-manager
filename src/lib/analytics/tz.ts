/**
 * IANA timezone helpers for analytics day bucketing (Analytics v2, Phase 1
 * item 12). Pure and dependency-free: built on `Intl.DateTimeFormat`, which
 * every supported browser and Node runtime ships with full tz data.
 *
 * Every client has a `clients.timezone` (default `Asia/Singapore`). A "day" on
 * the Analytics screen is a calendar day in that zone, so a Singapore site's
 * day starts at 00:00 SGT (16:00 UTC the previous day), not at 08:00 local.
 */

export const DEFAULT_TIMEZONE = 'Asia/Singapore';

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** `tz` if valid, otherwise the default zone. */
export function safeTimezone(tz: string | null | undefined): string {
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

/** Wall-clock parts of instant `ms` in `tz`. `month` is 1-12, `weekday` 0=Sunday. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second, weekday };
}

/** Offset of `tz` from UTC at instant `ms`, in ms (SGT → +8h). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Calendar day (`YYYY-MM-DD`) that instant `ms` falls on in `tz`. */
export function dayKeyInTz(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The UTC instant of wall-clock `y-m-d h:00` in `tz`. Handles DST: the offset
 * is re-evaluated at the candidate instant, and a wall time that does not
 * exist (spring-forward gap) resolves to the first instant after the gap.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, tz: string): number {
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall - tzOffsetMs(wall, tz);
  const offset2 = tzOffsetMs(guess, tz);
  if (wall - offset2 !== guess) guess = Math.max(guess, wall - offset2);
  return guess;
}

/** UTC instant of 00:00 on calendar day `key` in `tz`. */
export function zonedMidnightUtc(key: string, tz: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 0, tz);
}

/** Short zone label for UI copy, e.g. "GMT+8". Falls back to the IANA name. */
export function tzShortLabel(tz: string, atMs: number): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(atMs))
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Zones offered in Settings. Any valid IANA zone is accepted by the database. */
export const COMMON_TIMEZONES = [
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Bangkok', 'Asia/Manila',
  'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC',
];
