import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dailyBuckets, utcWindowStart, type AnalyticsEvent } from './page';

// Regression test for the UTC-vs-local bucketing bug described in the Phase 8
// whole-branch review: `analytics_daily.day` is always written as a UTC
// calendar day by the rollup cron
// (src/app/api/cron/rollup-analytics/route.ts), so bucket boundaries here
// must be computed from UTC date parts, not local ones. The old
// `setHours`/`getDate`/`setDate`-based construction only produced the wrong
// calendar day in a non-UTC timezone, so `TZ` is pinned to a non-UTC zone
// (UTC+8) for this file rather than relying on whatever zone the test
// runner happens to be in — a UTC CI runner would otherwise make this test
// pass for both the fixed and the reverted-buggy implementation.
const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Makassar';
});

afterAll(() => {
  process.env.TZ = originalTz;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('utcWindowStart', () => {
  it('anchors the window to the UTC calendar day, not the local one', () => {
    // 05:00 UTC on 6 Jul 2026 is still 6 Jul in UTC, but 13:00 local
    // (UTC+8) — same local calendar day, so this instant isolates the bug:
    // a local-midnight-based implementation subtracts a full local-TZ-width
    // offset before flooring to midnight, which lands on the *previous* UTC
    // day here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T05:00:00.000Z'));

    const start = utcWindowStart(1);

    expect(start.toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('offsets by (days - 1) UTC calendar days for multi-day windows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T05:00:00.000Z'));

    const start = utcWindowStart(7);

    expect(start.toISOString()).toBe('2026-06-30T00:00:00.000Z');
  });
});

describe('dailyBuckets (raw events)', () => {
  it('keys buckets by the UTC calendar day of created_at', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T05:00:00.000Z'));

    const events: AnalyticsEvent[] = [
      {
        id: '1', event_name: 'page_view', path: '/', title: null, referrer: null,
        visitor_id: null, session_id: null, device: null, browser: null, country: null,
        created_at: '2026-07-06T23:30:00.000Z',
      },
    ];

    const buckets = dailyBuckets(events, 7);

    expect(buckets.map((b) => b.key)).toEqual([
      '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
      '2026-07-04', '2026-07-05', '2026-07-06',
    ]);
    expect(buckets.find((b) => b.key === '2026-07-06')?.count).toBe(1);
  });
});
