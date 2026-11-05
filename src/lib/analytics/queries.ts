import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, fmtDayKey, keyToMs, type ResolvedRange } from '@/lib/analytics/range';
import {
  CONVERSION_EVENTS, EMPTY_COUNTS, ENGAGED_MIN_MS, ENGAGED_MIN_PAGE_VIEWS, ENGAGEMENT_TRACKER_VERSION,
  SYSTEM_EVENTS, type OverviewCounts,
} from '@/lib/analytics/metrics';
import { DAY_MS, utcDayKey } from '@/lib/dates';

/**
 * Data access for the Analytics screen: thin wrappers over the migration-027
 * RPCs, plus the pure helpers that turn their sparse results into complete,
 * labelled chart series. Everything aggregates in Postgres; nothing here
 * downloads raw events.
 */

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export type Dimension =
  | 'page' | 'entry_page' | 'exit_page' | 'referrer'
  | 'device' | 'browser' | 'country' | 'lang' | 'screen' | 'event';

export type BreakdownRow = { name: string; count: number; visitors: number; sessions: number };
export type SeriesPoint = {
  key: string;
  label: string;
  views: number;
  visitors: number;
  sessions: number;
  /** First and last day this bucket covers (clipped to the range), for drill-in. */
  startKey: string;
  endKey: string;
};
export type HourlyCell = { dow: number; hour: number; views: number };

export type Scope = { clientId: string | null; range: ResolvedRange; includeBots: boolean };

type RpcError = { message: string } | null;

export const GRANULARITY_LABELS: Record<Granularity, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' };

/** Granularities that make sense for a range (hourly only up to a week). */
export function allowedGranularities(days: number): Granularity[] {
  const out: Granularity[] = [];
  if (days <= 7) out.push('hour');
  out.push('day');
  if (days >= 14) out.push('week');
  if (days >= 60) out.push('month');
  return out;
}

export function defaultGranularity(days: number): Granularity {
  if (days === 1) return 'hour';
  if (days > 120) return 'week';
  return 'day';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Monday on or before `key` (ISO week start, matching Postgres date_trunc('week')). */
export function weekStart(key: string) {
  const dow = new Date(keyToMs(key)).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
}

/**
 * Every bucket in `range` for `granularity`, in order, keyed the way the
 * `analytics_timeseries` RPC keys them (its local wall-clock `bucket`
 * truncated to `YYYY-MM-DD` or `YYYY-MM-DDTHH`). Week/month buckets can start
 * before the range (a range starting mid-week); their data is still clipped to
 * the range by the query, and `startKey`/`endKey` are clipped too, so a
 * drill-in never leaves the selected dates.
 */
export function emptySeries(range: ResolvedRange, granularity: Granularity): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const zero = { views: 0, visitors: 0, sessions: 0 };
  const clip = (a: string, b: string) => ({ startKey: a < range.startKey ? range.startKey : a, endKey: b > range.endKey ? range.endKey : b });

  if (granularity === 'hour') {
    for (let d = 0; d < range.days; d++) {
      const key = addDays(range.startKey, d);
      for (let h = 0; h < 24; h++) {
        const label = range.days === 1 ? `${pad(h)}:00` : `${fmtDayKey(key, { day: 'numeric', month: 'short' })} ${pad(h)}:00`;
        out.push({ key: `${key}T${pad(h)}`, label, ...zero, startKey: key, endKey: key });
      }
    }
    return out;
  }

  if (granularity === 'day') {
    for (let d = 0; d < range.days; d++) {
      const key = addDays(range.startKey, d);
      out.push({ key, label: fmtDayKey(key, { day: 'numeric', month: 'short' }), ...zero, startKey: key, endKey: key });
    }
    return out;
  }

  if (granularity === 'week') {
    for (let key = weekStart(range.startKey); key <= range.endKey; key = addDays(key, 7)) {
      out.push({ key, label: `w/c ${fmtDayKey(key, { day: 'numeric', month: 'short' })}`, ...zero, ...clip(key, addDays(key, 6)) });
    }
    return out;
  }

  const [sy, sm] = range.startKey.split('-').map(Number);
  for (let i = 0; ; i++) {
    const key = utcDayKey(Date.UTC(sy, sm - 1 + i, 1));
    if (key > range.endKey) break;
    const last = utcDayKey(Date.UTC(sy, sm + i, 0));
    out.push({ key, label: fmtDayKey(key, { month: 'short', year: 'numeric' }), ...zero, ...clip(key, last) });
  }
  return out;
}

/** Normalizes an RPC `bucket` (e.g. "2026-09-10T00:00:00") to a series key. */
export function bucketKey(bucket: string, granularity: Granularity) {
  const iso = bucket.replace(' ', 'T');
  return granularity === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

/** Fills `emptySeries` with RPC rows; rows outside the range are ignored. */
export function fillSeries(
  range: ResolvedRange,
  granularity: Granularity,
  rows: { bucket: string; views: number; visitors: number; sessions: number }[],
): SeriesPoint[] {
  const series = emptySeries(range, granularity);
  const byKey = new Map(series.map((p) => [p.key, p]));
  for (const row of rows) {
    const point = byKey.get(bucketKey(row.bucket, granularity));
    if (!point) continue;
    point.views += Number(row.views);
    point.visitors += Number(row.visitors);
    point.sessions += Number(row.sessions);
  }
  return series;
}

/** Days covered by a series point, for "click to drill in". */
export function pointDays(p: SeriesPoint) {
  return Math.round((keyToMs(p.endKey) - keyToMs(p.startKey)) / DAY_MS) + 1;
}

function baseArgs(scope: Scope) {
  return {
    p_client: scope.clientId,
    p_from: scope.range.start.toISOString(),
    p_to: scope.range.endExclusive.toISOString(),
    p_include_bots: scope.includeBots,
  };
}

export function toCounts(data: Partial<Record<keyof OverviewCounts, unknown>> | null): OverviewCounts {
  if (!data) return EMPTY_COUNTS;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    page_views: n(data.page_views),
    visitors: n(data.visitors),
    sessions: n(data.sessions),
    custom_events: n(data.custom_events),
    event_types: n(data.event_types),
    measured_sessions: n(data.measured_sessions),
    engaged_sessions: n(data.engaged_sessions),
    total_engaged_ms: n(data.total_engaged_ms),
    measured_visitors: n(data.measured_visitors),
    new_visitors: n(data.new_visitors),
    conversions: n(data.conversions),
    tracker_version: data.tracker_version == null ? null : n(data.tracker_version),
  };
}

export async function fetchOverview(supabase: SupabaseClient, scope: Scope): Promise<{ data: OverviewCounts; error: string | null }> {
  const { data, error } = await supabase.rpc('analytics_overview', {
    ...baseArgs(scope),
    p_engaged_ms: ENGAGED_MIN_MS,
    p_engaged_views: ENGAGED_MIN_PAGE_VIEWS,
    p_conversion_events: CONVERSION_EVENTS,
    p_system_events: SYSTEM_EVENTS,
    p_engagement_tv: ENGAGEMENT_TRACKER_VERSION,
  }) as { data: Partial<Record<keyof OverviewCounts, unknown>> | null; error: RpcError };
  return { data: error ? EMPTY_COUNTS : toCounts(data), error: error?.message ?? null };
}

export async function fetchBreakdown(
  supabase: SupabaseClient, scope: Scope, dimension: Dimension, limit = 10,
): Promise<{ data: BreakdownRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('analytics_breakdown', {
    ...baseArgs(scope), p_dimension: dimension, p_limit: limit,
  }) as { data: BreakdownRow[] | null; error: RpcError };
  return {
    data: (data ?? []).map((r) => ({ name: r.name, count: Number(r.count), visitors: Number(r.visitors), sessions: Number(r.sessions) })),
    error: error?.message ?? null,
  };
}

export async function fetchSeries(
  supabase: SupabaseClient, scope: Scope, granularity: Granularity,
): Promise<{ data: SeriesPoint[]; error: string | null }> {
  const { data, error } = await supabase.rpc('analytics_timeseries', {
    ...baseArgs(scope), p_granularity: granularity, p_tz: scope.range.tz,
  }) as { data: { bucket: string; views: number; visitors: number; sessions: number }[] | null; error: RpcError };
  return { data: fillSeries(scope.range, granularity, data ?? []), error: error?.message ?? null };
}

export async function fetchHourly(supabase: SupabaseClient, scope: Scope): Promise<{ data: HourlyCell[]; error: string | null }> {
  const { data, error } = await supabase.rpc('analytics_hourly', {
    ...baseArgs(scope), p_tz: scope.range.tz,
  }) as { data: HourlyCell[] | null; error: RpcError };
  return {
    data: (data ?? []).map((c) => ({ dow: Number(c.dow), hour: Number(c.hour), views: Number(c.views) })),
    error: error?.message ?? null,
  };
}
