import { describe, expect, it } from 'vitest';
import { DAY_MS, daysAgoKey, daysSince, startOfUtcDay, utcDayKey } from './dates';

describe('DAY_MS', () => {
  it('is one day in milliseconds', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('matches every value it replaced', () => {
    // The four former declarations were 86_400_000 and 86400000.
    expect(DAY_MS).toBe(86_400_000);
    expect(DAY_MS).toBe(86400000);
  });
});

describe('utcDayKey', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(utcDayKey(new Date('2026-08-11T13:45:00.000Z'))).toBe('2026-08-11');
  });

  it('accepts a millisecond timestamp', () => {
    expect(utcDayKey(Date.UTC(2026, 7, 11, 13, 45))).toBe('2026-08-11');
  });

  it('accepts an ISO string', () => {
    expect(utcDayKey('2026-08-11T13:45:00.000Z')).toBe('2026-08-11');
  });

  it('buckets by UTC, not local time', () => {
    // 23:30 UTC is already the next day in Singapore (UTC+8). The rollup cron
    // writes UTC day keys, so this must stay on the UTC side of midnight.
    expect(utcDayKey('2026-08-11T23:30:00.000Z')).toBe('2026-08-11');
    expect(utcDayKey('2026-08-12T00:30:00.000Z')).toBe('2026-08-12');
  });

  it('produces exactly the format analytics_daily.day stores', () => {
    expect(utcDayKey(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is stable across the same day regardless of time', () => {
    const morning = utcDayKey('2026-08-11T00:00:00.000Z');
    const night = utcDayKey('2026-08-11T23:59:59.999Z');
    expect(morning).toBe(night);
  });
});

describe('daysSince', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);

  it('counts whole days elapsed', () => {
    expect(daysSince(new Date(now - 3 * DAY_MS).toISOString(), now)).toBe(3);
  });

  it('rounds down rather than to nearest', () => {
    expect(daysSince(new Date(now - (2 * DAY_MS + 23 * 3600_000)).toISOString(), now)).toBe(2);
  });

  it('returns 0 for something that just happened', () => {
    expect(daysSince(new Date(now - 1000).toISOString(), now)).toBe(0);
  });

  it('clamps a future timestamp to 0 instead of going negative', () => {
    expect(daysSince(new Date(now + 5 * DAY_MS).toISOString(), now)).toBe(0);
  });

  it('treats a missing or unparseable timestamp as 0', () => {
    expect(daysSince(null, now)).toBe(0);
    expect(daysSince(undefined, now)).toBe(0);
    expect(daysSince('', now)).toBe(0);
    expect(daysSince('not a date', now)).toBe(0);
  });

  it('reproduces the ageing threshold the dashboard filters on', () => {
    // DRAFT_AGE_DAYS = 14: a draft is "aging" only past 14 whole days.
    const fourteen = daysSince(new Date(now - 14 * DAY_MS).toISOString(), now);
    const fifteen = daysSince(new Date(now - 15 * DAY_MS).toISOString(), now);
    expect(fourteen > 14).toBe(false);
    expect(fifteen > 14).toBe(true);
  });
});

describe('daysAgoKey', () => {
  const from = new Date('2026-08-11T12:00:00.000Z');

  it('returns the day key N days earlier', () => {
    expect(daysAgoKey(1, from)).toBe('2026-08-10');
    expect(daysAgoKey(30, from)).toBe('2026-07-12');
  });

  it('returns today for 0', () => {
    expect(daysAgoKey(0, from)).toBe('2026-08-11');
  });

  it('crosses month and year boundaries', () => {
    expect(daysAgoKey(11, from)).toBe('2026-07-31');
    expect(daysAgoKey(365, new Date('2026-01-05T00:00:00.000Z'))).toBe('2025-01-05');
  });

  it('accepts a millisecond timestamp', () => {
    expect(daysAgoKey(1, from.getTime())).toBe('2026-08-10');
  });

  it('reproduces the 30-day sparkline window the dashboard charts', () => {
    // SPARKLINE_DAYS = 30, inclusive of today -> 29 days back.
    expect(daysAgoKey(29, from)).toBe('2026-07-13');
  });
});

describe('startOfUtcDay', () => {
  it('returns midnight UTC of the same calendar day', () => {
    expect(startOfUtcDay(new Date('2026-08-11T13:45:12.345Z')).toISOString())
      .toBe('2026-08-11T00:00:00.000Z');
  });

  it('is idempotent', () => {
    const once = startOfUtcDay(new Date('2026-08-11T13:45:00.000Z'));
    expect(startOfUtcDay(once).toISOString()).toBe(once.toISOString());
  });

  it('matches the window the rollup cron computes', () => {
    // "yesterday 00:00 UTC through now" — a 2-UTC-calendar-day window.
    const now = new Date('2026-08-11T02:15:00.000Z');
    const windowStart = new Date(startOfUtcDay(now).getTime() - DAY_MS);
    expect(windowStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });
});
