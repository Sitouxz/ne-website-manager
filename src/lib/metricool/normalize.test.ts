import { describe, it, expect } from 'vitest';
import { isoRange, normalizeTimeline, sumTimeline, normalizeInstagramPost } from './normalize';

describe('isoRange', () => {
  it('spans `days` UTC days ending today, anchored to UTC midnight/end-of-day', () => {
    const now = new Date('2026-07-14T09:30:00Z');
    const { from, to } = isoRange(7, now);
    expect(from).toBe('2026-07-08T00:00:00.000Z');
    expect(to).toBe('2026-07-14T23:59:59.000Z');
  });
});

describe('normalizeTimeline', () => {
  it('coerces [timestamp, value] tuples (epoch ms)', () => {
    const ms = Date.UTC(2026, 6, 1);
    const points = normalizeTimeline([[ms, 10], [ms + 86400000, 20]]);
    expect(points).toEqual([
      { date: new Date(ms).toISOString(), value: 10 },
      { date: new Date(ms + 86400000).toISOString(), value: 20 },
    ]);
  });

  it('coerces {date,value} objects and a {values:[...]} wrapper', () => {
    const points = normalizeTimeline({ values: [{ date: '2026-07-01', value: '5' }] });
    expect(points).toEqual([{ date: new Date('2026-07-01').toISOString(), value: 5 }]);
  });

  it('drops unusable rows instead of throwing', () => {
    const points = normalizeTimeline([{ nope: true }, null, ['bad'], { date: '2026-07-02', value: 3 }]);
    expect(points).toEqual([{ date: new Date('2026-07-02').toISOString(), value: 3 }]);
  });

  it('returns [] for a non-array, non-wrapper payload', () => {
    expect(normalizeTimeline('boom')).toEqual([]);
    expect(sumTimeline(normalizeTimeline(null))).toBe(0);
  });
});

describe('sumTimeline', () => {
  it('adds up point values', () => {
    expect(sumTimeline([{ date: 'a', value: 2 }, { date: 'b', value: 3 }])).toBe(5);
  });
});

describe('normalizeInstagramPost', () => {
  it('maps a well-formed post', () => {
    const post = normalizeInstagramPost({
      id: 123,
      caption: 'hi',
      date: '2026-07-01T00:00:00Z',
      picture: 'https://x/y.jpg',
      url: 'https://instagr.am/p/abc',
      likes: 40,
      comments: 5,
      engagement: 3.2,
    });
    expect(post).toEqual({
      id: '123',
      text: 'hi',
      publishedAt: '2026-07-01T00:00:00.000Z',
      imageUrl: 'https://x/y.jpg',
      permalink: 'https://instagr.am/p/abc',
      likes: 40,
      comments: 5,
      engagement: 3.2,
    });
  });

  it('returns null when there is no id', () => {
    expect(normalizeInstagramPost({ caption: 'no id' })).toBeNull();
    expect(normalizeInstagramPost('nope')).toBeNull();
  });

  it('defaults missing counts to 0 and null engagement', () => {
    const post = normalizeInstagramPost({ id: 'p1' });
    expect(post).toMatchObject({ id: 'p1', likes: 0, comments: 0, engagement: null, text: null });
  });
});
