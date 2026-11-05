import { describe, expect, it } from 'vitest';
import {
  avgEngagedMs, bounceRate, engagementRate, entryExitPages, fmtDuration, newVisitorShare,
  pagesPerSession, pctChange, returningVisitors, summarizeEvents, type MetricEvent,
} from './metrics';

let t = 0;
function ev(partial: Partial<MetricEvent>): MetricEvent {
  t += 1;
  return {
    event_name: 'page_view', session_id: 's1', visitor_id: 'v1', path: '/',
    created_at: new Date(Date.UTC(2026, 8, 1) + t * 1000).toISOString(),
    engaged_ms: null, is_new_visitor: null, tracker_version: null,
    ...partial,
  };
}

describe('summarizeEvents', () => {
  it('counts views, visitors, sessions and custom events', () => {
    const c = summarizeEvents([
      ev({}), ev({ path: '/a' }),
      ev({ session_id: 's2', visitor_id: 'v2' }),
      ev({ event_name: 'contact_click', session_id: 's2', visitor_id: 'v2' }),
      ev({ event_name: 'page_leave', engaged_ms: 500 }),
    ]);
    expect(c.page_views).toBe(3);
    expect(c.visitors).toBe(2);
    expect(c.sessions).toBe(2);
    expect(c.custom_events).toBe(1);
    expect(c.event_types).toBe(1);
  });

  it('legacy (pre-v3) sessions are not measured: engagement is null, not 0', () => {
    const c = summarizeEvents([ev({}), ev({ session_id: 's2' })]);
    expect(c.measured_sessions).toBe(0);
    expect(engagementRate(c)).toBeNull();
    expect(bounceRate(c)).toBeNull();
    expect(avgEngagedMs(c)).toBeNull();
    expect(newVisitorShare(c)).toBeNull();
    expect(pagesPerSession(c)).toBe(1);
  });

  // Same sessions as supabase/tests/analytics_v2.test.sql — keep them in sync.
  it('engaged session = ≥10s engaged, or ≥2 page views, or a conversion', () => {
    const c = summarizeEvents([
      // s1: one page, 12 s engaged → engaged
      ev({ session_id: 's1', tracker_version: 3 }),
      ev({ session_id: 's1', event_name: 'page_leave', engaged_ms: 12_000, tracker_version: 3 }),
      // s2: two pages, no engaged time → engaged
      ev({ session_id: 's2', tracker_version: 3 }), ev({ session_id: 's2', tracker_version: 3 }),
      // s3: one page, then a form submit → engaged
      ev({ session_id: 's3', tracker_version: 3 }),
      ev({ session_id: 's3', event_name: 'form_submit', tracker_version: 3 }),
      // s4: one page, 9.9 s split over two page_leave flushes → not engaged
      ev({ session_id: 's4', tracker_version: 3 }),
      ev({ session_id: 's4', event_name: 'page_leave', engaged_ms: 5_000, tracker_version: 3 }),
      ev({ session_id: 's4', event_name: 'page_leave', engaged_ms: 4_900, tracker_version: 3 }),
      // s5: legacy tracker → not measured at all
      ev({ session_id: 's5' }), ev({ session_id: 's5' }),
    ]);
    expect(c.sessions).toBe(5);
    expect(c.measured_sessions).toBe(4);
    expect(c.engaged_sessions).toBe(3);
    expect(engagementRate(c)).toBe(0.75);
    expect(bounceRate(c)).toBe(0.25);
    expect(c.total_engaged_ms).toBe(21_900);
    expect(avgEngagedMs(c)).toBe(5_475);
    expect(c.conversions).toBe(1);
    expect(c.tracker_version).toBe(3);
  });

  it('new vs returning visitors come from is_new_visitor', () => {
    const c = summarizeEvents([
      ev({ visitor_id: 'a', is_new_visitor: true }),
      ev({ visitor_id: 'a', is_new_visitor: true }),
      ev({ visitor_id: 'b', is_new_visitor: false }),
      ev({ visitor_id: 'c', is_new_visitor: false }),
      ev({ visitor_id: 'd' }),
    ]);
    expect(c.measured_visitors).toBe(3);
    expect(c.new_visitors).toBe(1);
    expect(returningVisitors(c)).toBe(2);
    expect(newVisitorShare(c)).toBeCloseTo(1 / 3);
  });
});

describe('entryExitPages', () => {
  it('uses the first and last page view of each session by time', () => {
    const { entries, exits } = entryExitPages([
      ev({ session_id: 'x', path: '/home', created_at: '2026-09-01T00:00:01Z' }),
      ev({ session_id: 'x', path: '/contact', created_at: '2026-09-01T00:00:09Z' }),
      ev({ session_id: 'x', path: '/about', created_at: '2026-09-01T00:00:05Z' }),
      ev({ session_id: 'y', path: '/home', created_at: '2026-09-01T00:00:02Z' }),
      ev({ session_id: 'y', event_name: 'page_leave', path: '/zzz', created_at: '2026-09-01T00:00:03Z' }),
    ]);
    expect(entries).toEqual([{ name: '/home', count: 2 }]);
    expect(exits).toEqual([{ name: '/contact', count: 1 }, { name: '/home', count: 1 }]);
  });
});

describe('pctChange and fmtDuration', () => {
  it('has no delta without a baseline', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
    expect(pctChange(15, 10)).toBe(0.5);
  });

  it('formats durations', () => {
    expect(fmtDuration(8_000)).toBe('8s');
    expect(fmtDuration(65_000)).toBe('1m 5s');
    expect(fmtDuration(3_725_000)).toBe('1h 2m');
    expect(fmtDuration(null)).toBe('–');
  });
});
