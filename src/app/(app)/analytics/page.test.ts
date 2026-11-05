import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dailyBuckets, type AnalyticsEvent } from './page';

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

    const buckets = dailyBuckets(events, new Date('2026-06-30T00:00:00.000Z'), 7);

    expect(buckets.map((b) => b.key)).toEqual([
      '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
      '2026-07-04', '2026-07-05', '2026-07-06',
    ]);
    expect(buckets.find((b) => b.key === '2026-07-06')?.count).toBe(1);
  });
});
