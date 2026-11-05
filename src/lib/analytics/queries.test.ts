import { describe, expect, it } from 'vitest';
import { allowedGranularities, bucketKey, defaultGranularity, emptySeries, fillSeries, pointDays, toCounts, weekStart } from './queries';
import { rangeFromKeys } from './range';

describe('series buckets', () => {
  it('daily buckets cover every day of the range, labelled without a year', () => {
    const s = emptySeries(rangeFromKeys('2026-09-28', '2026-10-02', 'Asia/Singapore'), 'day');
    expect(s.map((p) => p.key)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(s[0].label).toMatch(/28 Sep/);
  });

  it('hourly buckets for a single day are 24 HH:00 slots', () => {
    const s = emptySeries(rangeFromKeys('2026-09-30', '2026-09-30'), 'hour');
    expect(s).toHaveLength(24);
    expect([s[0].key, s[23].key, s[9].label]).toEqual(['2026-09-30T00', '2026-09-30T23', '09:00']);
  });

  it('weekly buckets start on Monday and clip their drill-in range to the selection', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28'); // Thursday → Monday
    const s = emptySeries(rangeFromKeys('2026-10-01', '2026-10-20'), 'week');
    expect(s.map((p) => p.key)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect([s[0].startKey, s[0].endKey, s[3].endKey]).toEqual(['2026-10-01', '2026-10-04', '2026-10-20']);
    expect(pointDays(s[1])).toBe(7);
  });

  it('monthly buckets cover each calendar month touched', () => {
    const s = emptySeries(rangeFromKeys('2026-08-15', '2026-10-03'), 'month');
    expect(s.map((p) => p.key)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect([s[0].startKey, s[1].endKey, s[2].endKey]).toEqual(['2026-08-15', '2026-09-30', '2026-10-03']);
  });

  it('fills RPC rows by their local wall-clock bucket and ignores out-of-range rows', () => {
    const r = rangeFromKeys('2026-09-10', '2026-09-11', 'Asia/Singapore');
    const s = fillSeries(r, 'day', [
      { bucket: '2026-09-10T00:00:00', views: 6, visitors: 4, sessions: 4 },
      { bucket: '2026-09-11 00:00:00', views: 1, visitors: 1, sessions: 1 },
      { bucket: '2026-09-12T00:00:00', views: 9, visitors: 9, sessions: 9 },
    ]);
    expect(s.map((p) => p.views)).toEqual([6, 1]);
    expect(bucketKey('2026-09-10T13:00:00', 'hour')).toBe('2026-09-10T13');
  });
});

describe('granularity choices', () => {
  it('offers hourly only up to a week and monthly only for long ranges', () => {
    expect(allowedGranularities(1)).toEqual(['hour', 'day']);
    expect(allowedGranularities(30)).toEqual(['day', 'week']);
    expect(allowedGranularities(90)).toEqual(['day', 'week', 'month']);
    expect([defaultGranularity(1), defaultGranularity(30), defaultGranularity(200)]).toEqual(['hour', 'day', 'week']);
  });
});

describe('toCounts', () => {
  it('coerces bigint strings and keeps a null tracker version null', () => {
    const c = toCounts({ page_views: '12', visitors: 3, tracker_version: null });
    expect([c.page_views, c.visitors, c.sessions, c.tracker_version]).toEqual([12, 3, 0, null]);
  });
});
