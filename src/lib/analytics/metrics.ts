/**
 * The one place every Analytics metric is defined (Analytics v2, Phase 1
 * item 9). The dashboard numbers are computed in Postgres by the
 * `analytics_*` RPCs (migration 027) for speed, but the thresholds they use
 * are passed in from the constants below, and `summarizeEvents` is the
 * TypeScript reference implementation of the same definitions: the unit
 * tests pin the semantics here, and `supabase/tests/analytics_v2.test.sql`
 * asserts the SQL returns the same numbers for the same sessions.
 *
 * ## Definitions
 * - **Session**: one `session_id` (a browser tab's sessionStorage ID).
 * - **Engaged session**: a session with at least `ENGAGED_MIN_MS` of engaged
 *   time, OR at least `ENGAGED_MIN_PAGE_VIEWS` page views, OR a conversion
 *   event (`CONVERSION_EVENTS`). This is GA4's definition.
 * - **Engagement rate** = engaged sessions / sessions.
 * - **Bounce rate** = 1 − engagement rate (GA4's definition — not Universal
 *   Analytics' "single-page session" bounce).
 * - **Engaged time**: time the page was visible and the visitor interacted
 *   (scroll, pointer, key, touch) within the last 10 s. Sent by tracker v3 in
 *   `page_leave` events.
 * - **Pages / session** = page views / sessions.
 * - **New visitor**: a visitor whose `visitor_id` was created during a session
 *   in the range (tracker v3 sends `is_new_visitor`). Returning = measured
 *   visitors − new visitors.
 * - **Entry page**: the first page view of a session. **Exit page**: the last.
 *
 * ## Measured vs. not collected
 * Engaged time and new/returning only exist for events sent by tracker v3+.
 * Rates that depend on them are computed over *measured* sessions/visitors
 * (those with v3 data) only, and are `null` — shown as "needs tracker v3",
 * never as 0 — when nothing in the range was measured.
 */

/** Minimum engaged time for a session to count as engaged. */
export const ENGAGED_MIN_MS = 10_000;
/** Minimum page views for a session to count as engaged. */
export const ENGAGED_MIN_PAGE_VIEWS = 2;
/** Events that count as a conversion (Phase 4 replaces this with goals). */
export const CONVERSION_EVENTS = ['form_submit'];
/** Tracker-internal events; not shown as "custom events". */
export const SYSTEM_EVENTS = ['page_view', 'page_leave'];
/** First tracker version that sends engagement data. */
export const ENGAGEMENT_TRACKER_VERSION = 3;
/** The version the SDK generator currently emits. */
export const CURRENT_TRACKER_VERSION = 3;

export type MetricEvent = {
  event_name: string;
  session_id: string | null;
  visitor_id: string | null;
  path: string;
  created_at: string;
  engaged_ms?: number | null;
  is_new_visitor?: boolean | null;
  tracker_version?: number | null;
};

/** Raw counts. Everything shown on screen is derived from these. */
export type OverviewCounts = {
  page_views: number;
  visitors: number;
  sessions: number;
  custom_events: number;
  event_types: number;
  /** Sessions with at least one tracker v3+ event. */
  measured_sessions: number;
  /** Measured sessions meeting the engaged-session definition. */
  engaged_sessions: number;
  /** Sum of engaged time over measured sessions. */
  total_engaged_ms: number;
  /** Visitors with at least one event carrying `is_new_visitor`. */
  measured_visitors: number;
  new_visitors: number;
  conversions: number;
  /** Highest tracker version seen, or null for pre-v3 trackers. */
  tracker_version: number | null;
};

export const EMPTY_COUNTS: OverviewCounts = {
  page_views: 0, visitors: 0, sessions: 0, custom_events: 0, event_types: 0,
  measured_sessions: 0, engaged_sessions: 0, total_engaged_ms: 0,
  measured_visitors: 0, new_visitors: 0, conversions: 0, tracker_version: null,
};

export function isEngagedSession(engagedMs: number, pageViews: number, converted: boolean) {
  return engagedMs >= ENGAGED_MIN_MS || pageViews >= ENGAGED_MIN_PAGE_VIEWS || converted;
}

/** Reference implementation of the overview counts (mirrors `analytics_overview`). */
export function summarizeEvents(events: MetricEvent[]): OverviewCounts {
  type S = { pageViews: number; engagedMs: number; converted: boolean; measured: boolean };
  const sessions = new Map<string, S>();
  const visitors = new Set<string>();
  const measuredVisitors = new Set<string>();
  const newVisitors = new Set<string>();
  const customNames = new Set<string>();
  let pageViews = 0;
  let customEvents = 0;
  let conversions = 0;
  let trackerVersion: number | null = null;

  for (const e of events) {
    if (e.visitor_id) visitors.add(e.visitor_id);
    if (e.event_name === 'page_view') pageViews += 1;
    if (!SYSTEM_EVENTS.includes(e.event_name)) {
      customEvents += 1;
      customNames.add(e.event_name);
    }
    const isConversion = CONVERSION_EVENTS.includes(e.event_name);
    if (isConversion) conversions += 1;
    if (e.tracker_version != null) trackerVersion = Math.max(trackerVersion ?? 0, e.tracker_version);
    if (e.visitor_id && e.is_new_visitor != null) {
      measuredVisitors.add(e.visitor_id);
      if (e.is_new_visitor) newVisitors.add(e.visitor_id);
    }
    if (!e.session_id) continue;
    const s = sessions.get(e.session_id) ?? { pageViews: 0, engagedMs: 0, converted: false, measured: false };
    if (e.event_name === 'page_view') s.pageViews += 1;
    s.engagedMs += Math.max(0, e.engaged_ms ?? 0);
    if (isConversion) s.converted = true;
    if ((e.tracker_version ?? 0) >= ENGAGEMENT_TRACKER_VERSION) s.measured = true;
    sessions.set(e.session_id, s);
  }

  let measured = 0;
  let engaged = 0;
  let engagedMs = 0;
  for (const s of sessions.values()) {
    if (!s.measured) continue;
    measured += 1;
    engagedMs += s.engagedMs;
    if (isEngagedSession(s.engagedMs, s.pageViews, s.converted)) engaged += 1;
  }

  return {
    page_views: pageViews,
    visitors: visitors.size,
    sessions: sessions.size,
    custom_events: customEvents,
    event_types: customNames.size,
    measured_sessions: measured,
    engaged_sessions: engaged,
    total_engaged_ms: engagedMs,
    measured_visitors: measuredVisitors.size,
    new_visitors: newVisitors.size,
    conversions,
    tracker_version: trackerVersion,
  };
}

/** Engaged sessions / measured sessions, or null when nothing was measured. */
export function engagementRate(c: OverviewCounts): number | null {
  return c.measured_sessions > 0 ? c.engaged_sessions / c.measured_sessions : null;
}

/** 1 − engagement rate (GA4 definition), or null when nothing was measured. */
export function bounceRate(c: OverviewCounts): number | null {
  const r = engagementRate(c);
  return r === null ? null : 1 - r;
}

/** Average engaged time per measured session in ms, or null. */
export function avgEngagedMs(c: OverviewCounts): number | null {
  return c.measured_sessions > 0 ? c.total_engaged_ms / c.measured_sessions : null;
}

export function pagesPerSession(c: OverviewCounts): number | null {
  return c.sessions > 0 ? c.page_views / c.sessions : null;
}

/** Share of measured visitors that are new, or null. */
export function newVisitorShare(c: OverviewCounts): number | null {
  return c.measured_visitors > 0 ? c.new_visitors / c.measured_visitors : null;
}

export function returningVisitors(c: OverviewCounts): number {
  return Math.max(0, c.measured_visitors - c.new_visitors);
}

/**
 * Relative change from `previous` to `current` (0.25 = +25%). Null when there
 * is no baseline (previous missing or 0) — a "+∞%" delta is not information.
 */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Entry and exit page per session (first/last page view by time). */
export function entryExitPages(events: MetricEvent[]) {
  const bySession = new Map<string, MetricEvent[]>();
  for (const e of events) {
    if (e.event_name !== 'page_view' || !e.session_id) continue;
    const list = bySession.get(e.session_id) ?? [];
    list.push(e);
    bySession.set(e.session_id, list);
  }
  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const first = list[0].path;
    const last = list[list.length - 1].path;
    entries.set(first, (entries.get(first) ?? 0) + 1);
    exits.set(last, (exits.get(last) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { entries: rank(entries), exits: rank(exits) };
}

// ── Formatting ───────────────────────────────────────────────────────────

/** 65_000 → "1m 5s", 8_000 → "8s", 3_725_000 → "1h 2m". */
export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtPct(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return '–';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtNumber(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
