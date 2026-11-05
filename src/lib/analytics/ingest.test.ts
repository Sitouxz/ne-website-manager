import { describe, expect, it } from 'vitest';
import { cleanReferrer, hostOf, normalizeEvent } from './ingest';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const NOW = Date.UTC(2026, 8, 30, 3, 0, 0);
const ctx = { clientId: 'c1', userAgent: CHROME, country: 'sg', nowMs: NOW };

describe('normalizeEvent', () => {
  it('defaults a bare payload to a page view on /', () => {
    const row = normalizeEvent({}, ctx)!;
    expect(row).toMatchObject({
      client_id: 'c1', event_name: 'page_view', path: '/', device: 'desktop', browser: 'Chrome',
      country: 'SG', is_bot: false, tracker_version: null, engaged_ms: null, created_at: new Date(NOW).toISOString(),
    });
  });

  it('rejects non-object payloads', () => {
    expect(normalizeEvent(null, ctx)).toBeNull();
    expect(normalizeEvent([1], ctx)).toBeNull();
    expect(normalizeEvent('x', ctx)).toBeNull();
  });

  it('accepts and clamps tracker v3 fields', () => {
    const row = normalizeEvent({
      event_name: 'page_leave', path: '/a', tv: 3, engaged_ms: 99_999_999, scroll_pct: 140,
      screen_w: 390.4, lang: 'en-SG', is_new_visitor: true, is_entry: true, age_ms: 2_000,
    }, ctx)!;
    expect(row.tracker_version).toBe(3);
    expect(row.engaged_ms).toBe(30 * 60_000);
    expect(row.scroll_pct).toBe(100);
    expect(row.screen_w).toBe(390);
    expect(row.lang).toBe('en-sg');
    expect(row.is_new_visitor).toBe(true);
    // is_entry only means something on a page view
    expect(row.is_entry).toBeNull();
    expect(row.created_at).toBe(new Date(NOW - 2_000).toISOString());
  });

  it('ignores engagement fields on non-leave events and wrong types everywhere', () => {
    const row = normalizeEvent({ event_name: 'page_view', engaged_ms: 5000, scroll_pct: 50, tv: '3', is_entry: 'yes', screen_w: 'big' }, ctx)!;
    expect([row.engaged_ms, row.scroll_pct, row.tracker_version, row.is_entry, row.screen_w]).toEqual([null, null, null, null, null]);
  });

  it('caps backdating at five minutes and never dates into the future', () => {
    expect(normalizeEvent({ age_ms: 86_400_000 }, ctx)!.created_at).toBe(new Date(NOW - 300_000).toISOString());
    expect(normalizeEvent({ age_ms: -5_000 }, ctx)!.created_at).toBe(new Date(NOW).toISOString());
  });

  it('strips query strings from referrers and derives the referrer host', () => {
    const row = normalizeEvent({ referrer: 'https://www.Google.com/search?q=my+email@x.com' }, ctx)!;
    expect(row.referrer).toBe('https://www.google.com/search');
    expect(row.referrer_host).toBe('google.com');
  });

  it('flags bots from the user agent', () => {
    expect(normalizeEvent({}, { ...ctx, userAgent: 'Googlebot/2.1' })!.is_bot).toBe(true);
  });

  it('drops oversized metadata', () => {
    expect(normalizeEvent({ metadata: { a: 'x'.repeat(3000) } }, ctx)!.metadata).toEqual({});
    expect(normalizeEvent({ metadata: { a: 1 } }, ctx)!.metadata).toEqual({ a: 1 });
  });
});

describe('referrer helpers', () => {
  it('rejects non-web referrers', () => {
    expect(cleanReferrer('javascript:alert(1)')).toBeNull();
    expect(cleanReferrer('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});
