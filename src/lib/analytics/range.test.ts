import { describe, expect, it } from 'vitest';
import { resolveRange } from './range';

const NOW = Date.UTC(2026, 8, 30, 10, 0, 0); // 30 Sep 2026

describe('resolveRange', () => {
  it('7d ends today and spans 7 UTC days', () => {
    const r = resolveRange('7d', NOW);
    expect([r.startKey, r.endKey, r.days]).toEqual(['2026-09-24', '2026-09-30', 7]);
    expect(r.endExclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('this month covers day 1 to the last day, including future days', () => {
    const r = resolveRange('this_month', Date.UTC(2026, 8, 10));
    expect([r.startKey, r.endKey, r.days]).toEqual(['2026-09-01', '2026-09-30', 30]);
  });

  it('this month handles 31-day months', () => {
    const r = resolveRange('this_month', Date.UTC(2026, 9, 5));
    expect([r.startKey, r.endKey, r.days]).toEqual(['2026-10-01', '2026-10-31', 31]);
  });

  it('last month crosses the year boundary', () => {
    const r = resolveRange('last_month', Date.UTC(2026, 0, 15));
    expect([r.startKey, r.endKey, r.days]).toEqual(['2025-12-01', '2025-12-31', 31]);
  });

  it('last month handles February in a non-leap year', () => {
    const r = resolveRange('last_month', Date.UTC(2026, 2, 3));
    expect([r.startKey, r.endKey, r.days]).toEqual(['2026-02-01', '2026-02-28', 28]);
  });

  it('custom is inclusive of both ends and swaps a reversed range', () => {
    const r = resolveRange('custom', NOW, '2026-09-10', '2026-09-05');
    expect([r.startKey, r.endKey, r.days]).toEqual(['2026-09-05', '2026-09-10', 6]);
  });

  it('custom supports a single day', () => {
    const r = resolveRange('custom', NOW, '2026-09-05', '2026-09-05');
    expect(r.days).toBe(1);
    expect(r.label).toBe('5 Sept 2026');
  });

  it('custom clamps to one year, keeping the end date', () => {
    const r = resolveRange('custom', NOW, '2020-01-01', '2026-09-30');
    expect(r.days).toBe(366);
    expect(r.endKey).toBe('2026-09-30');
  });

  it('custom falls back to 30 days for invalid input', () => {
    expect(resolveRange('custom', NOW, '2026-02-31', '2026-03-01').days).toBe(30);
    expect(resolveRange('custom', NOW, undefined, undefined).days).toBe(30);
  });
});
